const KnowledgeNote = require("../models/knowledgeNote");
const Preferences = require("../models/preferences");
const logger = require("../utils/logger");
const { parseServiceTables } = require("./serviceExpiryScanner");

// Ежедневный разбор таблиц услуг (домены, хостинг и т. п.) в активных заметках.
// Включается настройкой knowledgeBase.trackServiceExpiry. Результат пишем в
// note.serviceExpiry. Архивные заметки пропускаем — они «исчезли» из базы знаний.
const runServiceExpiryScan = async () => {
  const prefs = await Preferences.findOne({}).lean();

  if (!prefs?.knowledgeBase?.trackServiceExpiry) {
    return;
  }

  const notes = await KnowledgeNote.find(
    { archivedAt: null },
    { content: 1 },
  ).lean();

  const scannedAt = new Date();
  const operations = [];
  let notesWithServices = 0;

  for (const note of notes) {
    const entries = parseServiceTables(note.content);
    if (entries.length > 0) {
      notesWithServices += 1;
    }
    operations.push({
      updateOne: {
        filter: { _id: note._id },
        update: {
          $set: {
            "serviceExpiry.entries": entries,
            "serviceExpiry.scannedAt": scannedAt,
          },
        },
      },
    });
  }

  if (operations.length > 0) {
    await KnowledgeNote.bulkWrite(operations);
  }

  logger.log("info", "Knowledge base service-expiry scan completed", {
    scanned: notes.length,
    notesWithServices,
  });
};

module.exports = { runServiceExpiryScan };
