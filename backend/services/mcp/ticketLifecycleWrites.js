const { Types } = require("mongoose");
const { Ticket } = require("../../models/ticket");
const User = require("../../models/user");
const Company = require("../../models/company");
const Category = require("../../models/ticketCategory");
const Receipt = require("../../models/mcpTicketWrite");
const { AppError } = require("../../middleware/errorHandling");
const { ticketListFilter } = require("../ticketScope");
const { canAccessTicket } = require("../ticketAccess");
const { prepareNewTicket, applyTicketDetails, startTicketAi, cleanupTicketResources } = require("../ticketLifecycle");
const { endBindingsForTicket } = require("../messaging/bindings");
const { markSeen } = require("../ticketSeen");

const conflict = () => { throw new AppError("Ticket changed. Read it again before retrying.", 409); };
const denied = () => { throw new AppError("Ticket write access unavailable.", 403); };
const versionFilter = version => version === 0 ? { $in: [0, null] } : version;

async function draft(auth, args) {
  const body = { title: args.title, description: args.description, deadline: args.deadline,
    applicantId: args.applicantId, categoryId: args.categoryId, state: "Новая", source: "Другое" };
  const other = args.applicantId && args.applicantId !== auth.userId;
  if ((other || args.companyId) && !auth.can({ ticket: ["createForOthers"] })) denied();
  if (args.categoryId && !(await Category.exists({ _id: args.categoryId, isActive: { $ne: false } }))) {
    throw new AppError("Ticket category unavailable.", 400);
  }
  if (args.companyId || other) {
    const applicant = other && await User.findById(args.applicantId).select("company._id").lean();
    const companyId = args.companyId || applicant?.company?._id;
    const company = companyId && await Company.findOne({ _id: companyId, isActive: { $ne: false } }).select("alias").lean();
    if (!company) throw new AppError("Ticket company unavailable.", 400);
    body.company = JSON.stringify(company);
  }
  return prepareNewTicket({ auth, body });
}

async function claimEdit(ticket, args, auth, token) {
  if (ticket.mcpPendingWrite === token) return;
  if (ticket.mcpPendingWrite || (ticket.version ?? 0) !== args.expectedVersion) conflict();
  applyTicketDetails(ticket, args);
  ticket.updatedBy = auth.userId;
  ticket.version = args.expectedVersion + 1;
  ticket.mcpPendingWrite = token;
  ticket.$where = { ...ticketListFilter(auth), version: versionFilter(args.expectedVersion), mcpPendingWrite: null };
  try {
    await ticket.save({ validateModifiedOnly: true });
  } catch (error) {
    if (["VersionError", "DocumentNotFoundError"].includes(error.name)) conflict();
    throw error;
  }
}

async function remove(ticket, receipt, args, auth) {
  if (ticket) {
    // Save the cleanup inputs before removal. A retry after the ticket is gone
    // can still release its bindings, files, remote session and work links.
    const claimed = await Ticket.findOneAndUpdate({
      _id: ticket._id, ...ticketListFilter(auth), version: versionFilter(args.expectedVersion),
      mcpPendingWrite: { $in: [null, receipt.id] },
    }, { $set: { mcpPendingWrite: receipt.id } }, { returnDocument: "after", timestamps: false })
      .select("attachments.name num updatedAt").lean();
    if (!claimed) {
      await Ticket.updateOne({ _id: ticket._id, mcpPendingWrite: receipt.id }, { $unset: { mcpPendingWrite: 1 } }, { timestamps: false });
      conflict();
    }
    const fileNames = (claimed.attachments ?? []).map(file => file.name).filter(Boolean);
    await Receipt.updateOne({ _id: receipt.id }, { $set: { fileNames, deletionClaimed: true } });
    receipt.fileNames = fileNames;
    receipt.deletionClaimed = true;
    const removed = await Ticket.deleteOne({ _id: ticket._id, ...ticketListFilter(auth), version: versionFilter(args.expectedVersion),
      mcpPendingWrite: receipt.id, updatedAt: claimed.updatedAt ?? null });
    if (!removed.deletedCount && await Ticket.exists({ _id: ticket._id })) {
      await Ticket.updateOne({ _id: ticket._id, mcpPendingWrite: receipt.id }, { $unset: { mcpPendingWrite: 1 } }, { timestamps: false });
      conflict();
    }
  }
  if (!receipt.deletionClaimed) throw new AppError("Ticket not found.", 404);
  await cleanupTicketResources({ _id: receipt.record, num: args.num,
    attachments: (receipt.fileNames ?? []).map(name => ({ name })) }, auth);
  await endBindingsForTicket(receipt.record, "deleted");
}

async function mutateTicket({ action, args, keyId, auth, token, digest, writeHistory }) {
  if (action === "update" && !auth.can({ ticket: ["manage"] })) denied();
  if (action === "delete" && !auth.can({ ticket: ["delete"] })) denied();
  const adding = action === "add";
  if (adding && ((args.applicantId && args.applicantId !== auth.userId) || args.companyId) &&
      !auth.can({ ticket: ["createForOthers"] })) denied();
  let receipt = await Receipt.findById(token);
  if (receipt && receipt.digest !== digest) throw new AppError("Request ID already used with different arguments.", 409);
  const newId = new Types.ObjectId(token.slice(0, 24));
  const target = (receipt || adding) ? { _id: receipt?.record ?? newId } : { num: args.num };
  let ticket = await Ticket.findOne(target).select("+mcpPendingWrite");
  if (ticket && !canAccessTicket(ticket, auth)) denied();
  if (!receipt && !adding) {
    if (!ticket) throw new AppError("Ticket not found.", 404);
    if (ticket.mcpPendingWrite || (ticket.version ?? 0) !== args.expectedVersion) conflict();
  }
  if (!receipt) {
    const record = adding ? newId : ticket._id;
    receipt = await Receipt.findOneAndUpdate({ _id: token }, { $setOnInsert: {
      digest, record, tickets: [record], resultNum: args.num,
      resultVersion: adding ? 0 : args.expectedVersion + 1,
    } }, { upsert: true, returnDocument: "after" });
    if (receipt.digest !== digest) throw new AppError("Request ID already used with different arguments.", 409);
  }
  if (!receipt.applied) {
    if (action === "delete") {
      await remove(ticket, receipt, args, auth);
    } else if (adding) {
      if (!ticket) {
        const prepared = await draft(auth, args);
        ticket = prepared.ticket;
        ticket._id = newId;
        ticket.mcpPendingWrite = token;
        try {
          await ticket.save();
          startTicketAi(ticket, prepared.wantsAiCategory, prepared.wantsAiTitle);
        } catch (error) {
          if (error.code !== 11000) throw error;
          ticket = await Ticket.findById(newId).select("+mcpPendingWrite");
        }
      }
      if (!ticket || ticket.mcpPendingWrite !== token) conflict();
      receipt.resultNum = ticket.num;
      await markSeen(auth.userId, [ticket._id], ticket.createdAt);
    } else {
      if (!ticket) throw new AppError("Ticket not found.", 404);
      await claimEdit(ticket, args, auth, token);
    }
    await writeHistory(receipt, "ticket", action, auth, keyId);
    await Receipt.updateOne({ _id: token }, { $set: { applied: true, resultNum: receipt.resultNum }, $unset: { fileNames: 1 } });
  }
  if (action === "delete") return { num: args.num, deleted: true };
  await Ticket.updateOne({ _id: receipt.record, mcpPendingWrite: token }, { $unset: { mcpPendingWrite: 1 } }, { timestamps: false });
  return { num: receipt.resultNum, version: receipt.resultVersion };
}

module.exports = { mutateTicket };
