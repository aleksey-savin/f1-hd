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
//
// Заметку, написанную ИИ-агентом (note.agent.keyId), сканируем на секреты всегда,
// даже при выключенном scanForSecrets: агент читает такую заметку до проверки
// модератором, и пароль, который человек вписал при правке, дошёл бы до агентов
// без всякой проверки. Находка ставит secretsScan.flagged — заметка скрыта от агентов.
// Заметки людей по-прежнему зависят от переключателя.
//
// Настройки базы знаний грузятся через loadKbConfig (по умолчанию из Preferences);
// параметр нужен тестам, вызовы rescanNoteDerived(note) менять не нужно.
const defaultLoadKbConfig = async () => {
  const Preferences = require("../models/preferences");
  const prefs = await Preferences.findOne({}, { knowledgeBase: 1 }).lean();
  return prefs?.knowledgeBase || {};
};

const rescanNoteDerived = async (note, { loadKbConfig = defaultLoadKbConfig } = {}) => {
  const kb = (await loadKbConfig()) || {};
  const scannedAt = new Date();

  if (kb.scanForSecrets || Boolean(note.agent?.keyId)) {
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
