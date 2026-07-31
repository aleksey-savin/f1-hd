const Preferences = require("../models/preferences");
const { scanNote } = require("../services/secretsScanner");
const { parseServiceTables } = require("../services/serviceExpiryScanner");

// Пересчитать производные поля заметки (секреты + продление услуг) сразу после
// создания/правки, чтобы они не оставались устаревшими до соответствующего крона.
// Семантика крона сохранена: каждый блок — no-op без своего флага; для секретов
// сохраняем ignoredHashes (список «не секрет» модератора). Мутирует note; вызывать
// до note.save() — сканеры читают уже обновлённые title/plainText/content.
//
// Живёт помощником, а не приватной функцией контроллера: заметки заводит не
// только форма базы знаний, но и сохранение справки ИИ из карточки заявки
// (services/ticketAiTerms.js), и пропустить пересчёт там значило бы завести
// заметку, которую сканер секретов увидит только через час.
const rescanNoteDerived = async (note) => {
  const prefs = await Preferences.findOne({}, { knowledgeBase: 1 }).lean();
  const kb = prefs?.knowledgeBase || {};
  const scannedAt = new Date();

  if (kb.scanForSecrets) {
    const ignoredHashes = note.secretsScan?.ignoredHashes || [];
    const findings = scanNote(note, ignoredHashes);
    note.secretsScan = {
      flagged: findings.length > 0,
      findings,
      ignoredHashes,
      scannedAt,
    };
  }

  // Крон разбора услуг пропускает архивные заметки — повторяем это здесь
  if (kb.trackServiceExpiry && !note.archivedAt) {
    note.serviceExpiry = {
      entries: parseServiceTables(note.content),
      scannedAt,
    };
  }
};

module.exports = { rescanNoteDerived };
