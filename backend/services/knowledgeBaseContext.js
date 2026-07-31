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

// ── Совпадение по тексту ────────────────────────────────────────────────────
// Привязка к компании — это не «про то же самое»: у компании с полудюжиной
// заметок в «приоритетный источник» уезжали все подряд, и на заявке про 1С
// модель читала про миграцию CRM и про договор с провайдером. Поэтому заметки
// ещё и сопоставляются со словами заявки.
//
// Морфологии нет намеренно: сравниваем пятибуквенные основы, и «открывается»
// сходится с «открыть», а «серверы» с «сервером».
const STEM_LENGTH = 5;
const MIN_WORD_LENGTH = 4;

// Что считаем словом. Коротких исключения два, и оба нужны: «1с» — самое важное
// слово половины заявок, а «vpn», «rdp», «crm» короче порога. Чистые числа не
// берём вовсе: «21» из темы «21 ВЕК» находилось в маске подсети внутри заметки
// про интернет — совпадение есть, смысла нет.
const isMeaningfulWord = (word) => {
  if (!word || /^\d+$/.test(word)) return false;
  if (/\d/.test(word)) return true;
  if (/^[a-z]+$/.test(word)) return word.length >= 3;
  return word.length >= MIN_WORD_LENGTH;
};

const stem = (word) =>
  word.length > STEM_LENGTH ? word.slice(0, STEM_LENGTH) : word;

// Слова заявки, совпадение по которым не значит ничего: вежливость, канцелярит
// и слова, которые есть в любой заметке.
const STOP_WORDS = [
  "который",
  "когда",
  "чтобы",
  "этот",
  "этого",
  "была",
  "были",
  "было",
  "быть",
  "есть",
  "очень",
  "просто",
  "нужно",
  "надо",
  "можно",
  "пожалуйста",
  "добрый",
  "день",
  "здравствуйте",
  "спасибо",
  "заявка",
  "заявки",
  "клиент",
  "сообщил",
  "просит",
  "уточнил",
  "снова",
  "опять",
  "также",
  "более",
  "менее",
  "после",
  "через",
  "всего",
  "только",
  "тоже",
  "если",
  "данные",
  "момент",
  "информация",
  "сообщение",
  "решение",
  "попробуйте",
  "появляется",
  "внимание",
  "просьба",
  "необходимо",
  "требуется",
];
const STOP_STEMS = new Set(STOP_WORDS.map(stem));

const toStems = (value) =>
  new Set(
    String(value || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .split(/[^0-9a-zа-я]+/)
      .filter(isMeaningfulWord)
      .map(stem)
      .filter((key) => !STOP_STEMS.has(key)),
  );

// Слово из заголовка заметки весит больше: заголовок называет предмет, а текст
// может упомянуть его вскользь.
const scoreNote = (note, ticketStems) => {
  if (!ticketStems.size) return 0;

  const title = toStems(note.title);
  const body = toStems(note.plainText);
  let score = 0;

  ticketStems.forEach((key) => {
    if (title.has(key)) score += 3;
    else if (body.has(key)) score += 1;
  });

  return score;
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
  b.score - a.score ||
  b.textScore - a.textScore ||
  b.matchCount - a.matchCount ||
  (TYPE_PRIORITY[b.type] || 1) - (TYPE_PRIORITY[a.type] || 1) ||
  new Date(b.updatedAt) - new Date(a.updatedAt);

/**
 * Заметки базы знаний, связанные с контекстом заявки (компания / категория /
 * инициатор) — совпадение хотя бы по одному измерению, ранжирование по
 * релевантности, топ MAX_NOTES.
 *
 * Привязка отбирает кандидатов, слова заявки решают, кто из них поедет в
 * промпт. Ступени сужения — по убыванию доверия к сигналу:
 *   1. заметки, задетые словами ТЕМЫ заявки («Не открывается 1С» → заметка про
 *      1С). Тема называет предмет, описание вокруг него пересказывает разговор;
 *   2. если таких нет — задетые словами описания (тема бывает пустой или
 *      «Re: заявка» из письма);
 *   3. если нет и таких — прежний порядок по привязкам.
 * Не задетые никем в промпт не едут: «приоритетный источник» из чужой темы
 * вреднее, чем его отсутствие.
 *
 * Видимость: AI-руководство — общий staff-only артефакт (генерируется в фоне без
 * пользовательского контекста, в getOne удаляется для end-user), поэтому per-user
 * canViewNote здесь НЕ применяется — берём все связанные заметки.
 *
 * @param {string} [params.title] тема заявки
 * @param {string} [params.text] описание заявки
 * @returns {Promise<Array>} заметки с полями title, type, plainText
 */
exports.collectRelevantNotes = async ({
  companyId,
  categoryId,
  applicantId,
  title,
  text,
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

  const titleStems = toStems(title);
  const textStems = toStems(text);
  const candidates = notes
    .filter((note) =>
      matchesTicketContext(note, { companyId, categoryId, applicantId }),
    )
    .map((note) => ({
      ...annotate(note, companyId, categoryId, applicantId),
      score: scoreNote(note, titleStems),
      textScore: scoreNote(note, textStems),
    }));

  const byTitle = candidates.filter((note) => note.score > 0);
  const byText = candidates.filter((note) => note.textScore > 0);
  const chosen = byTitle.length ? byTitle : byText.length ? byText : candidates;

  return chosen.sort(byRelevance).slice(0, MAX_NOTES);
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
