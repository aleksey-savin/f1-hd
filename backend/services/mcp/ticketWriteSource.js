const { createHash } = require("node:crypto");
const { Types } = require("mongoose");
const McpKey = require("../../models/mcpKey");
const User = require("../../models/user");
const Company = require("../../models/company");
const Preferences = require("../../models/preferences");
const Comment = require("../../models/comment");
const Work = require("../../models/work");
const { Ticket } = require("../../models/ticket");
const TicketLog = require("../../models/ticketLog");
const Receipt = require("../../models/mcpTicketWrite");
const { buildAuthContext, isDeniedAccount } = require("../authContext");
const { loadAccessibleTicket, assertTicketsAccessible } = require("../ticketAccess");
const { AppError } = require("../../middleware/errorHandling");
const { canEditWork, canDeleteWork, isAlwaysWithinPlan, applyWorkTaxiDecision } = require("../workMutationPolicy");
const { classify } = require("../ticketEvents");

const { markSeen } = require("../ticketSeen");
const withRequest = require("./keyLock").createKeyLock();

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const deny = () => { throw new AppError("Ticket write access unavailable.", 403); };
const conflict = () => { throw new AppError("Record changed or another write is pending. Check the ticket and retry.", 409); };
const events = {
  ticket: { add: "создана новая заявка", update: "заявка обновлена", delete: "заявка удалена" },
  comment: { add: "добавлен комментарий", update: "изменён комментарий", delete: "удалён комментарий" },
  work: { add: "добавлены работы", update: "обновлены работы", delete: "удалены работы" },
};

async function resolveActor(keyId, kind, action) {
  const key = await McpKey.findOne({ _id: keyId, scopes: "ticketsWrite" }).select("createdBy").lean();
  const user = key?.createdBy && await User.findById(key.createdBy);
  if (!user || user.isEndUser !== false || isDeniedAccount(user)) deny();
  if (user.company?._id && await Company.exists({ _id: user.company._id, isActive: false })) deny();
  const auth = await buildAuthContext(user);
  if (kind === "work") {
    const enabled = await Preferences.exists({ "modules.timeTracking.isActive": true });
    const canLog = auth.can({ work: ["log"] });
    if (!enabled || !auth.can({ work: ["read"] }) ||
        !(canLog || (action !== "add" && auth.can({ work: ["manage"] })))) deny();
  }
  return auth;
}

async function checkRecord(kind, action, row, ticket, auth) {
  const belongs = kind === "work" ? row?.tickets.some(id => String(id) === String(ticket._id))
    : row && (row.ticketId ? String(row.ticketId) === String(ticket._id)
      : ticket.comments.some(id => String(id) === String(row._id)) &&
        !(await Ticket.exists({ _id: { $ne: ticket._id }, comments: row._id })));
  if (!belongs) throw new AppError("Record not found on this ticket.", 404);
  if (kind === "work") {
    if (!(action === "delete" ? canDeleteWork(row, auth) : canEditWork(row, auth))) deny();
    return;
  }
  if (row.source === "email" || row.emailMessageId || row.quotedText || row.channel?.messageId || row.channel?.network) {
    throw new AppError("Mail and conversation comments are managed by their source.", 409);
  }
  if (String(row.createdBy?._id ?? row.createdBy) !== auth.userId && !auth.can({ ticket: ["manage"] })) deny();
}

function expectedRevision(row, input) {
  const current = row.updatedAt ? new Date(row.updatedAt).toISOString() : "legacy";
  if (current !== input) conflict();
  return row.updatedAt ?? null;
}

async function prepareWork(row, args, ticket, auth, adding) {
  const performer = { _id: auth.userId, firstName: auth.legacy.firstName, lastName: auth.legacy.lastName };
  const hadVisit = Boolean(row.visitRequired && row.startedAt && row.finishedAt);
  for (const field of ["description", "startedAt", "finishedAt", "visitRequired"]) {
    if (args[field] !== undefined) row.set(field, args[field]);
  }
  if (args.startedAt !== undefined || args.finishedAt !== undefined) {
    if (!row.startedAt || !row.finishedAt || !(row.startedAt < row.finishedAt)) {
      throw new AppError("Work must finish after it starts.", 400);
    }
  }
  if (adding) {
    row.tickets = [ticket._id];
    row.company = ticket.company._id;
    row.finances = { status: "preview" };
    row.createdBy = performer;
  }
  if (row.finishedAt && !row.finishedBy?._id) row.finishedBy = performer;
  row.updatedBy = performer;
  if (await isAlwaysWithinPlan(row.tickets)) row.withinPlan = true;
  await applyWorkTaxiDecision(auth, row, row.taxiTripIds ?? [], undefined, hadVisit ? row.taxiDecision : "pending");
  if (!adding && args.visitRequired) row.notifications = { lastAction: "scheduled work updated", pending: true };
}

async function writeHistory(receipt, kind, action, auth, keyId) {
  const event = events[kind][action];
  for (const ticketId of receipt.tickets) {
    const id = hash([receipt.id, String(ticketId)]).slice(0, 24);
    await TicketLog.updateOne({ _id: id }, { $setOnInsert: {
      ticketId, actorId: auth.userId, mcpKeyId: keyId, event, kind: classify(event),
      user: { firstName: auth.legacy.firstName, lastName: auth.legacy.lastName },
      severity: "info", createdAt: receipt.createdAt, updatedAt: receipt.createdAt,
    } }, { upsert: true, timestamps: false });
  }
}

// A standalone Mongo deployment cannot transact across the record, ticket and
// history. Claim the revision on the record first. A replay of the same request
// can finish the remaining idempotent steps after any interrupted write.
async function mutate({ kind, action, args, keyId }) {
  const auth = await resolveActor(keyId, kind, action);
  const token = hash([String(keyId), args.requestId]);
  const digest = hash([kind, action, Object.entries(args).sort(([a], [b]) => a.localeCompare(b))]);
  if (kind === "ticket") {
    return require("./ticketLifecycleWrites").mutateTicket({ action, args, keyId, auth, token, digest, writeHistory });
  }
  const ticket = await loadAccessibleTicket(auth, { num: args.num });
  const Model = kind === "comment" ? Comment : Work;
  let receipt = await Receipt.findById(token);
  if (receipt && receipt.digest !== digest) throw new AppError("Request ID already used with different arguments.", 409);
  const adding = action === "add";
  const record = adding ? new Types.ObjectId(token.slice(0, 24)) : args.id;
  const fields = kind === "comment" ? "+mcpPendingWrite +emailMessageId" : "+mcpPendingWrite";
  let row = receipt?.applied ? null : await Model.findById(record).select(fields);
  if (receipt && kind === "work") await assertTicketsAccessible(auth, receipt.tickets);
  if (!receipt?.applied) {
    if (!adding) {
      await checkRecord(kind, action, row, ticket, auth);
      if (kind === "work") await assertTicketsAccessible(auth, row.tickets);
      if (row.mcpPendingWrite !== token) expectedRevision(row, args.revision);
    }
    if (row?.mcpPendingWrite && row.mcpPendingWrite !== token) conflict();
    if (!receipt) {
      const revision = new Date(Math.max(Date.now(), Number(row?.updatedAt ?? 0) + 1));
      receipt = await Receipt.findOneAndUpdate({ _id: token }, { $setOnInsert: {
        digest, record, tickets: kind === "work" && row ? row.tickets : [ticket._id], revision,
      } }, { upsert: true, returnDocument: "after" });
      if (receipt.digest !== digest) throw new AppError("Request ID already used with different arguments.", 409);
      if (receipt.applied) return mutate({ kind, action, args, keyId });
    }
    if (row?.mcpPendingWrite !== token) {
      if (adding && row) conflict();
      if (adding) row = new Model({ _id: receipt.record });
      if (action !== "delete") {
        if (kind === "work") await prepareWork(row, args, ticket, auth, adding);
        else {
          row.content = args.content;
          row.updatedBy = auth.userId;
          if (adding) {
            row.ticketId = ticket._id;
            row.createdBy = auth.userId;
            row.notifications = { lastAction: "new comment", pending: false };
          }
        }
      }
      if (kind === "comment" && action === "delete") row.set("notifications.pending", false);
      const previous = row.updatedAt ?? null;
      row.mcpPendingWrite = token;
      row.updatedAt = receipt.revision;
      if (adding) row.createdAt = receipt.revision;
      else row.$where = { updatedAt: previous, mcpPendingWrite: null };
      try {
        await row.save({ timestamps: false, validateBeforeSave: action !== "delete", validateModifiedOnly: !adding });
      } catch (error) {
        if (error.code !== 11000 && !["VersionError", "DocumentNotFoundError"].includes(error.name)) throw error;
        const claimed = await Model.exists({ _id: record, mcpPendingWrite: token });
        if (!claimed) conflict();
      }
    }
    if (kind === "comment" && action !== "update") {
      const update = adding ? { $addToSet: { comments: record } } : { $pull: { comments: record } };
      const linked = await Ticket.updateOne({ _id: ticket._id }, update);
      if (!linked.matchedCount) throw new AppError("Ticket no longer exists.", 404);
      if (adding) await markSeen(auth.userId, [ticket._id], receipt.revision);
    }
    await writeHistory(receipt, kind, action, auth, keyId);
    await Receipt.updateOne({ _id: token }, { $set: { applied: true } });
  }
  const claim = { _id: receipt.record, mcpPendingWrite: token };
  if (action === "delete") await Model.deleteOne(claim);
  else {
    const release = { $unset: { mcpPendingWrite: 1 } };
    if (kind === "comment" && adding) release.$set = { "notifications.pending": true };
    await Model.updateOne(claim, release, { timestamps: false });
  }
  return { id: String(receipt.record), ...(action === "delete" ? { deleted: true } : { revision: receipt.revision.toISOString() }) };
}
module.exports = {
  mutate: input => withRequest(hash([String(input.keyId), input.args.requestId]), () => mutate(input)),
};
