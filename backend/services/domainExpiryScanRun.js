const KnowledgeNote = require("../models/knowledgeNote");
const Preferences = require("../models/preferences");
const logger = require("../utils/logger");
const { parseDomainTables } = require("./domainExpiryScanner");

// Ежедневный разбор таблиц доменов/хостинга в активных заметках. Включается
// настройкой knowledgeBase.trackDomainExpiry. Результат пишем в note.domainExpiry.
// Архивные заметки пропускаем — они «исчезли» из базы знаний.
const runDomainExpiryScan = async () => {
  const prefs = await Preferences.findOne({}).lean();

  if (!prefs?.knowledgeBase?.trackDomainExpiry) {
    return;
  }

  const notes = await KnowledgeNote.find(
    { archivedAt: null },
    { content: 1 },
  ).lean();

  const scannedAt = new Date();
  const operations = [];
  let notesWithDomains = 0;

  for (const note of notes) {
    const entries = parseDomainTables(note.content);
    if (entries.length > 0) {
      notesWithDomains += 1;
    }
    operations.push({
      updateOne: {
        filter: { _id: note._id },
        update: {
          $set: {
            "domainExpiry.entries": entries,
            "domainExpiry.scannedAt": scannedAt,
          },
        },
      },
    });
  }

  if (operations.length > 0) {
    await KnowledgeNote.bulkWrite(operations);
  }

  logger.log("info", "Knowledge base domain-expiry scan completed", {
    scanned: notes.length,
    notesWithDomains,
  });
};

module.exports = { runDomainExpiryScan };
