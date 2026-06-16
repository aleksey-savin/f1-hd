const KnowledgeNote = require("../models/knowledgeNote");
const Preferences = require("../models/preferences");
const logger = require("../utils/logger");

// Сбрасывает одобрение у заметок, чей срок одобрения истёк.
// approvalPeriodDays берётся из настроек; 0/falsy — функция выключена.
// Заметки без approvedAt (например, помеченные миграцией) не трогаем — мы не
// знаем момент их одобрения. Заметки на удалении тоже не трогаем — их пруном
// занимается модератор вручную.
const runKnowledgeApprovalExpiry = async () => {
  const prefs = await Preferences.findOne({}).lean();
  const days = prefs?.knowledgeBase?.approvalPeriodDays || 0;

  if (!days || days <= 0) {
    return;
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await KnowledgeNote.updateMany(
    { approved: true, approvedAt: { $lte: cutoff } },
    { $set: { approved: false }, $unset: { approvedBy: "", approvedAt: "" } },
  );

  if (result.modifiedCount > 0) {
    logger.log("info", "Knowledge note approvals expired", {
      modifiedCount: result.modifiedCount,
      approvalPeriodDays: days,
    });
  }
};

module.exports = { runKnowledgeApprovalExpiry };
