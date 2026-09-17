const KnowledgeNote = require("@/models/knowledgeNote");
const { scopeFilter } = require("./knowledgeTools");

/**
 * Чтение заметок для MCP-инструментов (knowledgeTools.js) — уже в границе.
 *
 * Поля границы (approved, archivedAt, pendingDeletion, secretsScan.flagged)
 * выбираются обязательно: `isServable` проверяет их ещё раз в памяти, и без
 * них отбросил бы всё.
 */
const SEARCH_FIELDS = [
  "title",
  "type",
  "plainText",
  "companies",
  "categories",
  "users",
  "approved",
  "approvedAt",
  "archivedAt",
  "pendingDeletion",
  "pendingArchive",
  "secretsScan.flagged",
].join(" ");

// Поиск текста целиком не читает: `content` может нести base64-картинки.
const NOTE_FIELDS = `${SEARCH_FIELDS} content createdAt`;

exports.findCandidates = () =>
  KnowledgeNote.find(scopeFilter()).select(SEARCH_FIELDS).lean();

exports.findNoteById = (id) =>
  KnowledgeNote.findOne({ _id: id, ...scopeFilter() })
    .select(NOTE_FIELDS)
    .lean();
