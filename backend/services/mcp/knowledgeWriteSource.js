const KnowledgeNote = require("@/models/knowledgeNote");
const Company = require("@/models/company");
const TicketCategory = require("@/models/ticketCategory");
const { rescanNoteDerived } = require("@/helpers/knowledgeNoteDerived");
const { buildCompanies, buildCategories, normalizeType } = require("@/helpers/knowledgeNoteBindings");
const { canFor } = require("@/services/permissions");
const { findStaffByTelegram } = require("./requester");

/**
 * Чтение и запись заметок для MCP-инструментов записи (knowledgeWriteTools.js)
 * — единственный файл семьи, который трогает модели. Сохранение идёт тем же
 * путём, что и из формы: привязки строятся теми же помощниками, производные
 * поля (секреты, продление услуг) пересчитываются до save.
 */

// Поля границы обязательны: инструмент проверяет isServable на результате
const WRITE_FIELDS = "title content type companies categories approved agent archivedAt pendingDeletion secretsScan";
const LIVE_FIELDS = "title approved agent archivedAt pendingDeletion secretsScan.flagged";
const SAVED = (note) => ({
  _id: note._id,
  title: note.title,
  type: note.type,
  companies: note.companies,
  categories: note.categories,
});

exports.findRequester = async (telegramId) => {
  const user = await findStaffByTelegram(telegramId);
  if (!user || user.error) return user;
  // canFor считает по ролям и требует полный документ пользователя
  return { _id: user._id, canManage: Boolean((await canFor(user))({ knowledge: ["manage"] })) };
};

// Те же условия, что у формы заметки (controllers/knowledgeNote.js#getFormData):
// отключённую компанию или категорию агент не привяжет, как и человек
exports.loadDirectory = async () => {
  const [companies, categories] = await Promise.all([
    Company.find({ isActive: { $ne: false } }).select("alias fullTitle").lean(),
    TicketCategory.find({ isActive: true }).select("title").lean(),
  ]);
  return { companies, categories };
};

exports.listLiveNotes = () => KnowledgeNote.find({ archivedAt: null }).select(LIVE_FIELDS).lean();

exports.countCreatedSince = (keyId, since) =>
  KnowledgeNote.countDocuments({ "agent.keyId": keyId, "agent.at": { $gte: since } });

exports.findForWrite = (id) => KnowledgeNote.findById(id).select(WRITE_FIELDS).lean();

exports.createNote = async ({ title, content, plainText, type, companyIds, categoryIds, requesterId, agent }) => {
  const note = new KnowledgeNote({
    title,
    content,
    plainText,
    companies: await buildCompanies(companyIds),
    users: [],
    categories: await buildCategories(categoryIds),
    type: normalizeType(type),
    createdBy: requesterId,
    updatedBy: requesterId,
    agent,
  });
  await rescanNoteDerived(note);
  await note.save();
  return SAVED(note);
};

exports.updateNote = async (id, patch) => {
  const note = await KnowledgeNote.findById(id);
  if (!note) throw new Error("knowledge note disappeared between the check and the write");
  if (patch.title !== undefined) note.title = patch.title;
  if (patch.content !== undefined) {
    note.content = patch.content;
    note.plainText = patch.plainText;
  }
  if (patch.type !== undefined) note.type = normalizeType(patch.type);
  if (patch.companyIds !== undefined) note.companies = await buildCompanies(patch.companyIds);
  if (patch.categoryIds !== undefined) note.categories = await buildCategories(patch.categoryIds);
  note.updatedBy = patch.requesterId;
  // Любая правка снимает «Проверено» — как из формы
  note.approved = false;
  note.approvedBy = undefined;
  note.approvedAt = undefined;
  await rescanNoteDerived(note);
  await note.save();
  return SAVED(note);
};
