const { Ticket } = require("../../models/ticket");
const Preferences = require("../../models/preferences");
const User = require("../../models/user");
const Company = require("../../models/company");
const ClientDevice = require("../../models/inventory/clientDevice");
const logger = require("../../utils/logger");

// Resolve the embedded { _id, alias } company for a Mikrotik record. Standalone
// records carry companyId directly; inventory-backed records inherit it from the
// linked ClientDevice. Returns undefined when it can't be resolved (the ticket is
// still worth creating without a company).
const resolveCompany = async (record) => {
  let companyId = record.companyId;
  if (!companyId && record.clientDevice) {
    const device = await ClientDevice.findById(record.clientDevice).select(
      "companyId",
    );
    companyId = device?.companyId;
  }
  if (!companyId) return undefined;

  const company = await Company.findById(companyId).select("alias");
  if (!company) return undefined;
  return { _id: company._id, alias: company.alias };
};

// Create a helpdesk ticket authored by the Mikrotik module (offline alert / config
// change). There is no system/bot user, so the author is the configured
// `Preferences.defaultApplicant` (the established convention for machine-created
// tickets). Deadline follows the global `Preferences.deadline` (hours). Setting
// `notifications.pending` lets the notifications cron deliver it.
//
// Never throws — a failed alert must not break the poll/cron loop; it logs and
// returns null so the caller can decide whether to retry later.
const createMikrotikTicket = async (
  record,
  { title, description, categoryId = null },
) => {
  try {
    const prefs = await Preferences.findOne({});
    const applicantId = prefs?.defaultApplicant?._id;
    if (!applicantId) {
      logger.warn(
        "Mikrotik ticket skipped: Preferences.defaultApplicant is not set",
      );
      return null;
    }

    const applicant = await User.findById(applicantId).select("_id");
    if (!applicant) {
      logger.warn(
        "Mikrotik ticket skipped: defaultApplicant user not found",
      );
      return null;
    }

    const company = await resolveCompany(record);
    const deadlineHours = prefs?.deadline || 10;
    const now = new Date();

    const ticket = new Ticket({
      title,
      description: description || "",
      categoryId: categoryId || null,
      applicantId: applicant._id,
      company,
      deadline: new Date(now.getTime() + deadlineHours * 60 * 60 * 1000),
      isClosed: false,
      state: "Новая",
      source: "Мониторинг устройств",
      createdBy: applicant._id,
      updatedBy: applicant._id,
      notifications: { lastAction: "new ticket", pending: true },
    });
    await ticket.save();
    return ticket;
  } catch (error) {
    logger.log("error", "Failed to create Mikrotik ticket", {
      error: error.message,
      recordId: record?._id,
    });
    return null;
  }
};

module.exports = { createMikrotikTicket };
