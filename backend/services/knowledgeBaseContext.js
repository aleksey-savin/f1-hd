const KnowledgeNote = require("@/models/knowledgeNote");

// Сколько релевантных заметок максимум подмешивать в контекст модели и сколько
// символов брать из каждой (plainText уже очищен от markdown — см. модель).
const MAX_NOTES = 5;
const MAX_NOTE_LENGTH = 1500;

// Значимость типа при ранжировании — синхронно с фронтендом
// (frontend/src/util/knowledgeNoteTypes.js): бэклог > инструкции > информация.
const TYPE_PRIORITY = { backlog: 3, instructions: 2, info: 1 };

// Человекочитаемая метка типа для промпта (модели понятнее, чем код типа).
const TYPE_LABEL = {
  info: "Информация",
  backlog: "Известная проблема",
  instructions: "Инструкция",
};

const includesId = (items, id) =>
  !!id && (items || []).some((item) => item?._id?.toString() === id.toString());

const idList = (items = []) =>
  items.map((item) => item?._id?.toString()).filter(Boolean);

// Подходит ли заметка контексту заявки с учётом ограничительных привязок.
// Компания и инициатор — ограничения: привязанная к ним заметка не «протекает» в
// чужие заявки. Категория ограничением не является. Та же логика, что в
// knowledgeNote.getRelated (карточка «База знаний»), чтобы AI не получал в
// контекст заметки других компаний.
const matchesTicketContext = (note, { companyId, categoryId, applicantId }) => {
  const noteCompanyIds = idList(note.companies);
  const noteUserIds = idList(note.users);
  const noteCategoryIds = idList(note.categories);

  const company = companyId?.toString();
  const category = categoryId?.toString();
  const applicant = applicantId?.toString();

  if (noteCompanyIds.length && !(company && noteCompanyIds.includes(company))) {
    return false;
  }

  if (noteUserIds.length && !(applicant && noteUserIds.includes(applicant))) {
    return false;
  }

  const matchCompany = !!company && noteCompanyIds.includes(company);
  const matchCategory = !!category && noteCategoryIds.includes(category);
  const matchUser = !!applicant && noteUserIds.includes(applicant);

  return matchCompany || matchCategory || matchUser;
};

const truncate = (value, max = MAX_NOTE_LENGTH) => {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

// Помечает заметку совпадениями по измерениям заявки и считает релевантность —
// та же логика, что в карточке «База знаний» (frontend RelatedNotes.jsx),
// но на сервере и с учётом контента заметки.
const annotate = (note, companyId, categoryId, applicantId) => {
  const matchCount =
    includesId(note.companies, companyId) +
    includesId(note.categories, categoryId) +
    includesId(note.users, applicantId);
  return { ...note, matchCount };
};

const byRelevance = (a, b) =>
  b.matchCount - a.matchCount ||
  (TYPE_PRIORITY[b.type] || 1) - (TYPE_PRIORITY[a.type] || 1) ||
  new Date(b.updatedAt) - new Date(a.updatedAt);

/**
 * Заметки базы знаний, связанные с контекстом заявки (компания / категория /
 * инициатор) — совпадение хотя бы по одному измерению, ранжирование по
 * релевантности, топ MAX_NOTES.
 *
 * Видимость: AI-руководство — общий staff-only артефакт (генерируется в фоне без
 * пользовательского контекста, в getOne удаляется для end-user), поэтому per-user
 * canViewNote здесь НЕ применяется — берём все связанные заметки.
 *
 * @returns {Promise<Array>} заметки с полями title, type, plainText
 */
exports.collectRelevantNotes = async ({
  companyId,
  categoryId,
  applicantId,
} = {}) => {
  const or = [];
  if (companyId) or.push({ "companies._id": companyId });
  if (categoryId) or.push({ "categories._id": categoryId });
  if (applicantId) or.push({ "users._id": applicantId });

  if (!or.length) return [];

  // Архивные заметки в контекст AI не подмешиваем
  const notes = await KnowledgeNote.find({ $or: or, archivedAt: null })
    .select("title type plainText companies categories users updatedAt")
    .lean();

  return notes
    .filter((note) =>
      matchesTicketContext(note, { companyId, categoryId, applicantId }),
    )
    .map((note) => annotate(note, companyId, categoryId, applicantId))
    .sort(byRelevance)
    .slice(0, MAX_NOTES);
};

/**
 * Форматирует заметки в текстовый блок для промпта.
 * @returns {string} пустая строка, если заметок нет
 */
exports.buildKnowledgeContext = (notes = []) => {
  if (!notes.length) return "";
  return notes
    .map((note) => {
      const label = TYPE_LABEL[note.type] || TYPE_LABEL.info;
      const body = truncate(note.plainText) || "(нет текста)";
      return `--- [${label}] ${note.title} ---\n${body}`;
    })
    .join("\n\n");
};
