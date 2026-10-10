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
//
// Картинка — `![подпись](data:…)`: подпись без «]», адрес начинается с «data:»
// (перед ним допустимы пробелы) и идёт до первой «)». Прежняя регулярка
// /!\[([^\]]*)\]\(\s*data:[^)]*\)/gi от каждого «![» заново искала «]» и «)» до
// конца текста: «![](data:» ×N без «)» — 160 КБ за 1,7 с, мегабайт — минуты, а
// заметку отдают целиком (до 50 МБ). Ближайшие «]» и «)» и проверка «](  data:»
// считаются один раз и переиспользуются (так же устроен unwrapLinks в
// helpers/markdownToPlainText); совпадения те же. DATA_URI из helpers/textScan
// сюда не подходит: он знает только base64, а здесь адрес — любой, до «)».
const DATA_URL_HEAD = /\s*data:/iy;

/**
 * Заменяет картинки с data:-адресом; replacement получает подпись картинки.
 * @param {string} text
 * @param {(alt: string) => string} replacement
 */
const replaceDataImages = (text, replacement) => {
  let out = "";
  let from = 0;
  let bracket = -1; // ближайшая «]» правее текущего кандидата
  let checked = -1; // для какой «]» посчитан dataEnd
  let dataEnd = -1; // конец «](  data:» у этой «]»; -1 — это не data-картинка
  let paren = -1; // ближайшая «)» правее dataEnd
  let at = text.indexOf("![");

  while (at !== -1) {
    const label = at + 2;
    if (bracket < label) bracket = text.indexOf("]", label);
    // «]» дальше нет — картинок тоже
    if (bracket === -1) break;

    // Одна «]» бывает у многих «![»: проверку «](  data:» делаем один раз на «]»
    if (checked !== bracket) {
      checked = bracket;
      dataEnd = -1;
      if (text[bracket + 1] === "(") {
        DATA_URL_HEAD.lastIndex = bracket + 2;
        if (DATA_URL_HEAD.test(text)) dataEnd = DATA_URL_HEAD.lastIndex;
      }
    }
    if (dataEnd === -1) {
      at = text.indexOf("![", at + 1);
      continue;
    }

    if (paren < dataEnd) paren = text.indexOf(")", dataEnd);
    // «)» дальше нет — ни эта, ни следующие картинки не закрываются
    if (paren === -1) break;

    out += text.slice(from, at) + replacement(text.slice(label, bracket));
    from = paren + 1;
    at = text.indexOf("![", from);
  }

  return out + text.slice(from);
};

const prepareContent = (content) => {
  const text = replaceDataImages(String(content || ""), (alt) =>
    alt.trim() ? `[изображение: ${alt.trim()}]` : "[изображение]",
  ).replace(DATA_URI, "[данные]");
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
// Ссылка — только в заметке целиком: поиск даёт адрес один раз в заголовке
const describe = (note) => [
  `id: ${note._id}; type: ${TYPE_LABEL[note.type] || TYPE_LABEL.info}; approved: ${iso(note.approvedAt)}`,
  `companies: ${listOf(note.companies, (company) => company?.alias)}; categories: ${listOf(note.categories, (category) => category?.title)}`,
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
        ...describe(hit.note),
        `snippet: ${buildSnippet(hit.note.plainText, needles) || "—"}`,
      ].join("\n   "),
    );
    return textResult(
      [
        `Found ${hits.length} approved notes for "${q}"; showing ${shown.length}, best match first; note link: ${noteLink(baseUrl, "<id>")}.`,
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
        ...describe(note),
        `link: ${noteLink(baseUrl, note._id)}`,
        `users: ${users}`,
        "",
        prepareContent(note.content) || "(empty note)",
      ].join("\n"),
    );
  },
});

// prepareContent — наружу ради тестов: getNote разбирает текст уже после await, и
// vm-таймаут теста, прерывающий регулярку, до него не достаёт
module.exports = { scopeFilter, isServable, createKnowledgeTools, prepareContent };
