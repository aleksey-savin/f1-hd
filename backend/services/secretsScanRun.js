const KnowledgeNote = require("../models/knowledgeNote");
const Preferences = require("../models/preferences");
const logger = require("../utils/logger");
const { scanNote } = require("./secretsScanner");

// Почасовой проход по всем заметкам в поиске утечек секретов.
// Включается настройкой knowledgeBase.scanForSecrets. Результат пишем в
// note.secretsScan (flagged + замаскированные находки + время сканирования).
const runSecretsScan = async () => {
  const prefs = await Preferences.findOne({}).lean();

  if (!prefs?.knowledgeBase?.scanForSecrets) {
    return;
  }

  const notes = await KnowledgeNote.find(
    {},
    { title: 1, plainText: 1, "secretsScan.ignoredHashes": 1 },
  ).lean();

  const scannedAt = new Date();
  const operations = [];
  let flaggedCount = 0;

  for (const note of notes) {
    const ignoredHashes = note.secretsScan?.ignoredHashes || [];
    const findings = scanNote(note, ignoredHashes);
    const flagged = findings.length > 0;
    if (flagged) {
      flaggedCount += 1;
    }

    // Точечный $set, чтобы не затереть ignoredHashes (список «не секрет» модератора)
    operations.push({
      updateOne: {
        filter: { _id: note._id },
        update: {
          $set: {
            "secretsScan.flagged": flagged,
            "secretsScan.findings": findings,
            "secretsScan.scannedAt": scannedAt,
          },
        },
      },
    });
  }

  if (operations.length > 0) {
    await KnowledgeNote.bulkWrite(operations);
  }

  logger.log("info", "Knowledge base secrets scan completed", {
    scanned: notes.length,
    flagged: flaggedCount,
  });
};

module.exports = { runSecretsScan };
