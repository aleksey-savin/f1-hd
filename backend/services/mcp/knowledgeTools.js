const {
  toStems,
  scoreNote,
  TYPE_LABEL,
  TYPE_PRIORITY,
} = require("@/services/knowledgeBaseContext");
const { buildSnippet, iso, DATA_URI, fallbackTerms, hasAllTerms } = require("./text");

/**
 * Чтение базы знаний ИИ-агентом по MCP (routes/mcp.js): поиск и заметка целиком.
 *
 * ГРАНИЦА — одобренные заметки без флага утечки, не в архиве и не на удалении.
 * Своего поиска секретов здесь нет намеренно (решение владельца 2026-09-17):
 * одобрение требует от модератора подтвердить «нет секретов», правка снимает
 * одобрение, а флаг ставит сканер. Смотрим только на ТЕКУЩИЙ `flagged`: у
 * заметки, где модератор снял все находки («Не секрет» пересчитывает флаг),
 * история находок остаётся в `ignoredHashes`, и отдавать её агенту нужно.
 *
 * Граница проверяется дважды: фильтром запроса (`scopeFilter`) и `isServable`
 * на каждом результате — источник, отдавший лишнее, её не прорвёт.
 *
 * Зависимости приходят аргументами: модуль не тянет ни модели, ни логгер и
 * проверяется на заготовках без базы (knowledgeTools.test.js).
 */

// Новый объект на каждый вызов: Mongoose при приведении типов переписывает
// условия фильтра на месте, общий объект между запросами делить нельзя.
const scopeFilter = () => ({
  archivedAt: null,
  pendingDeletion: { $ne: true },
  approved: true,
  "secretsScan.flagged": { $ne: true },
});

const isServable = (note) =>
  Boolean(note) &&
  note.approved === true &&
  note.archivedAt == null &&
  note.pendingDeletion !== true &&
  note.secretsScan?.flagged !== true;

const MAX_QUERY_LENGTH = 300;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
// Потолок текста заметки в ответе: клиент MCP сам режет ответы больше 10 МБ,
// а модели и 40 тысяч знаков — уже пара десятков страниц контекста.
const MAX_CONTENT_LENGTH = 40_000;
// Совпадение с компанией, категорией или человеком из привязок заметки весит
// между заголовком (3) и текстом (1): «VPN Ромашка» — это заметка Ромашки.
const BINDING_WEIGHT = 2;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

// Ответ на скрытую, несуществующую и кривую ссылку один и тот же: по нему
// нельзя понять, что заметка есть, но агенту её не отдают.
const NOT_AVAILABLE =
  "Note not available. Use an id returned by search_knowledge_base.";

const bindingsText = (note) =>
  [
    ...(note.companies || []).map((company) => company?.alias),
    ...(note.categories || []).map((category) => category?.title),
    ...(note.users || []).map((user) =>
      [user?.lastName, user?.firstName].filter(Boolean).join(" "),
    ),
  ]
    .filter(Boolean)
    .join(" ");

const scoreByStems = (note, stems) => {
  const bindings = toStems(bindingsText(note));
  let bonus = 0;
  stems.forEach((key) => {
    if (bindings.has(key)) bonus += BINDING_WEIGHT;
  });
  return scoreNote(note, stems) + bonus;
};

// Свежесть — по approvedAt, не по updatedAt: до 2026-09-17 почасовой сканер
// секретов переписывал updatedAt у всех заметок разом, и старые значения не
// восстанавливали. А правка текста снимает одобрение — у одобренной заметки
// текст не менялся с момента проверки.
const byRank = (a, b) =>
  b.score - a.score ||
  (TYPE_PRIORITY[b.note.type] || 1) - (TYPE_PRIORITY[a.note.type] || 1) ||
  new Date(b.note.approvedAt || 0) - new Date(a.note.approvedAt || 0);

/**
 * Основы слов запроса — как у руководства по заявке. Если основ нет (IP-адрес,
 * число) или по ним ничего не нашлось, каждое слово запроса ищется подстрокой:
 * `192.168.10.5` и `srv-dc01` находятся буквально.
 */
const rankNotes = (notes, query) => {
  const stems = toStems(query);
  const byStems = stems.size
    ? notes
        .map((note) => ({ note, score: scoreByStems(note, stems) }))
        .filter((hit) => hit.score > 0)
    : [];
  if (byStems.length) {
    return { hits: byStems.sort(byRank), needles: [...stems] };
  }

  const terms = fallbackTerms(query);
  const bySubstring = notes
    .filter((note) =>
      hasAllTerms(`${note.title} ${note.plainText} ${bindingsText(note)}`, terms),
    )
    .map((note) => ({ note, score: 1 }));
  return { hits: bySubstring.sort(byRank), needles: terms };
};

// Картинки, вставленные в редактор, живут в тексте base64-строкой (Toast UI
// кладёт data:-URL прямо в Markdown) — агенту от них только расход контекста.
const DATA_IMAGE = /!\[([^\]]*)\]\(\s*data:[^)]*\)/gi;

const prepareContent = (content) => {
  const text = String(content || "")
    .replace(DATA_IMAGE, (match, alt) =>
      alt.trim() ? `[изображение: ${alt.trim()}]` : "[изображение]",
    )
    .replace(DATA_URI, "[данные]");
  if (text.length <= MAX_CONTENT_LENGTH) return text;
  const rest = text.length - MAX_CONTENT_LENGTH;
  return `${text.slice(0, MAX_CONTENT_LENGTH)}\n\n[…truncated: ${rest} more characters — open the link to read the whole note]`;
};

const listOf = (items, pick) =>
  (items || []).map(pick).filter(Boolean).join(", ") || "—";

const noteLink = (baseUrl, id) =>
  `${String(baseUrl || "").replace(/\/+$/, "")}/knowledge-base/${id}`;

// «Обновлено» агенту не показываем: у старых заметок updatedAt — время
// прохода сканера секретов, не правки текста (см. byRank).
const describe = (note, baseUrl) => [
  `id: ${note._id}; type: ${TYPE_LABEL[note.type] || TYPE_LABEL.info}; approved: ${iso(note.approvedAt)}`,
  `companies: ${listOf(note.companies, (company) => company?.alias)}; categories: ${listOf(note.categories, (category) => category?.title)}`,
  `link: ${noteLink(baseUrl, note._id)}`,
];

const errorResult = (text) => ({
  isError: true,
  content: [{ type: "text", text }],
});

const textResult = (text) => ({ content: [{ type: "text", text }] });

const whoCalls = (caller) => ({
  mcpKeyId: caller?.keyId,
  mcpKeyName: caller?.keyName,
});

/**
 * @param {object} deps
 * @param {() => Promise<object[]>} deps.findCandidates заметки для поиска (lean)
 * @param {(id: string) => Promise<object|null>} deps.findNoteById заметка целиком (lean)
 * @param {string} [deps.baseUrl] публичный адрес HD для ссылок (ADDRESS)
 * @param {(level: string, message: string, meta: object) => void} deps.log
 */
const createKnowledgeTools = ({
  findCandidates,
  findNoteById,
  baseUrl,
  log,
}) => ({
  search: async ({ query, limit } = {}, caller) => {
    const started = Date.now();
    const q = String(query ?? "")
      .trim()
      .slice(0, MAX_QUERY_LENGTH);
    if (!q) {
      log("info", "MCP tool call", {
        ...whoCalls(caller),
        tool: "search_knowledge_base",
        query: "",
        hits: 0,
        durationMs: Date.now() - started,
      });
      return errorResult(
        "Query is empty. Pass a few keywords, for example «vpn офис».",
      );
    }

    const shownLimit = Number.isInteger(limit)
      ? Math.min(Math.max(limit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const notes = (await findCandidates()).filter(isServable);
    const { hits, needles } = rankNotes(notes, q);
    const shown = hits.slice(0, shownLimit);

    log("info", "MCP tool call", {
      ...whoCalls(caller),
      tool: "search_knowledge_base",
      query: q.slice(0, 100),
      hits: hits.length,
      durationMs: Date.now() - started,
    });

    if (!shown.length) {
      return textResult(
        `No approved notes match "${q}". Try other keywords (notes are mostly in Russian) or fewer words.`,
      );
    }

    const blocks = shown.map((hit, index) =>
      [
        `${index + 1}. ${hit.note.title}`,
        ...describe(hit.note, baseUrl),
        `snippet: ${buildSnippet(hit.note.plainText, needles) || "—"}`,
      ].join("\n   "),
    );
    return textResult(
      [
        `Found ${hits.length} approved notes for "${q}"; showing ${shown.length}, best match first.`,
        ...blocks,
      ].join("\n\n"),
    );
  },

  getNote: async ({ id } = {}, caller) => {
    const started = Date.now();
    const noteId = String(id ?? "").trim();
    const note = OBJECT_ID.test(noteId) ? await findNoteById(noteId) : null;
    const found = isServable(note);

    log("info", "MCP tool call", {
      ...whoCalls(caller),
      tool: "get_knowledge_note",
      noteId: noteId.slice(0, 64),
      found,
      durationMs: Date.now() - started,
    });

    if (!found) return errorResult(NOT_AVAILABLE);

    const users = listOf(note.users, (user) => {
      const name = [user?.lastName, user?.firstName].filter(Boolean).join(" ");
      const company = user?.company?.alias ? ` (${user.company.alias})` : "";
      return name ? `${name}${company}` : "";
    });
    return textResult(
      [
        `# ${note.title}`,
        ...describe(note, baseUrl),
        `users: ${users}`,
        "",
        prepareContent(note.content) || "(empty note)",
      ].join("\n"),
    );
  },
});

module.exports = { scopeFilter, isServable, createKnowledgeTools };
