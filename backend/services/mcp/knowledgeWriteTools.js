const { TYPE_LABEL } = require("@/services/knowledgeBaseContext");
const { scanNote, scanText } = require("@/services/secretsScanner");
const { withoutMarkers } = require("@/services/portalMarkers");
const { markdownToPlainText } = require("@/helpers/markdownToPlainText");
const { isServable, isAgentNote } = require("./knowledgeTools");
const { resolveByName } = require("./ticketQuery");
const { normalize } = require("./text");
const { TELEGRAM_ID } = require("./requester");
const { createKeyLock } = require("./keyLock");

/**
 * Запись в базу знаний ИИ-агентом по MCP (routes/mcp.js): завести заметку и
 * поправить заметку, заведённую агентом.
 *
 * Правила (docs/superpowers/specs/2026-10-11-mcp-knowledge-write-design.md):
 *  - автор — человек, попросивший агента: его Telegram id обязателен, и у него
 *    должно быть право вести базу знаний;
 *  - заметка заводится непроверенной и с отметкой `agent`; править агент может
 *    только заметки с этой отметкой — проверенную человеком заметку он из
 *    «Проверено» не выбьет;
 *  - текст с найденным секретом не сохраняется вовсе, включён поиск секретов в
 *    настройках или нет: черновик агент читает сразу, до модератора;
 *  - удалять, архивировать и проверять агент не может.
 *
 * Зависимости приходят аргументами, модуль проверяется на заготовках без базы
 * (knowledgeWriteTools.test.js).
 */

const DAILY_LIMIT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TITLE = 200;
const MAX_CONTENT = 40_000;
const MAX_BINDINGS = 10;
const NOTE_TYPES = ["info", "backlog", "instructions"];
const OBJECT_ID = /^[a-f0-9]{24}$/i;
// Картинка или вложение прямо в тексте: data:<mime>, с base64 или без
const DATA_URL = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+[;,]/i;

// На поиск не ссылаемся: у ключа с одной записью инструмента поиска нет
const NOT_AVAILABLE = "Note not available. Use the id of a note written by an agent.";
const HUMAN_NOTE =
  "This note was written by a person and can only be changed in the helpdesk. Write a new note instead.";

const errorResult = (text) => ({ isError: true, content: [{ type: "text", text }] });
const textResult = (text) => ({ content: [{ type: "text", text }] });
const refusal = (reasons) => errorResult(["The note was not saved:", ...reasons.map((reason) => `- ${reason}`)].join("\n"));

const titleKey = (title) => normalize(title).trim().replace(/\s+/g, " ");

const noteLink = (baseUrl, id) => `${String(baseUrl || "").replace(/\/+$/, "")}/knowledge-base/${id}`;

const NAME_RULES = {
  company: {
    plural: "companies",
    label: (item) => `${item.alias || ""} ${item.fullTitle || ""}`,
    exact: (item) => [item.alias, item.fullTitle].filter(Boolean),
    show: (item) => item.alias || item.fullTitle,
  },
  category: {
    plural: "categories",
    label: (item) => item.title || "",
    exact: (item) => [item.title].filter(Boolean),
    show: (item) => item.title,
  },
};

// Имена → id; каждая ошибка — отдельной причиной, чтобы агент исправил все разом
const resolveNames = (kind, names, items, reasons) => {
  const rule = NAME_RULES[kind];
  const ids = [];
  for (const raw of names) {
    const name = String(raw ?? "").trim();
    if (!name) {
      // Пустое имя — ошибка вызова: молча пропустив его, сняли бы привязки
      const reason = `${rule.plural}: a name is empty`;
      if (!reasons.includes(reason)) reasons.push(reason);
      continue;
    }
    const matches = resolveByName(items, name, rule);
    if (!matches.length) {
      reasons.push(`No ${kind} matches "${name}". Check the name or leave it out.`);
    } else if (matches.length > 1) {
      reasons.push(`Several ${rule.plural} match "${name}": ${matches.slice(0, 10).map(rule.show).join("; ")}. Repeat with a more specific name.`);
    } else if (!ids.includes(matches[0]._id)) {
      ids.push(matches[0]._id);
    }
  }
  return ids;
};

// Заголовок уходит одной строкой в списки, ссылки и ответы агентам. Не годятся:
// управляющие знаки (переводы строк, табуляция), DEL, U+0085, невидимые
// U+200B–U+200F, U+2060, U+FEFF и разделители строк U+2028/U+2029.
// Коды, а не регулярка с самими знаками: невидимое в исходнике не прочесть.
const TITLE_FORBIDDEN = [
  [0x00, 0x1f],
  [0x7f, 0x7f],
  [0x85, 0x85],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x2060, 0x2060],
  [0xfeff, 0xfeff],
];
const hasForbiddenTitleChar = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (TITLE_FORBIDDEN.some(([from, to]) => code >= from && code <= to)) return true;
  }
  return false;
};

const checkTitle = (title, reasons) => {
  const value = String(title ?? "").trim();
  if (!value) reasons.push("title is empty");
  else if (hasForbiddenTitleChar(value)) reasons.push("title must be one line of ordinary characters");
  else if (value.length > MAX_TITLE) reasons.push(`title is longer than ${MAX_TITLE} characters`);
  return value;
};

const checkContent = (content, reasons) => {
  const value = String(content ?? "");
  if (!value.trim()) reasons.push("content is empty");
  else if (value.length > MAX_CONTENT) reasons.push(`content is longer than ${MAX_CONTENT} characters: split it into several notes`);
  else if (DATA_URL.test(value)) reasons.push("embedded images and data: URIs are not accepted: describe the picture in words");
  return value;
};

const checkList = (name, list, reasons) => {
  if (!Array.isArray(list)) {
    reasons.push(`${name} must be a list of names`);
    return [];
  }
  if (list.length > MAX_BINDINGS) reasons.push(`${name}: at most ${MAX_BINDINGS} names`);
  return list.slice(0, MAX_BINDINGS);
};

// Эвристики сканера. На сыром Markdown они принимают обычную конфигурацию в блоках
// кода (interface=ether1-WAN, публичные ключи WireGuard) за секреты, поэтому для
// сырого текста их отбрасываем; в простом тексте (вне блоков кода) они работают.
const { HEURISTIC_CATEGORIES, hasUrlPassword, secretFields, secretFieldLines } = require("../knowledgeRawSecrets");

// Сохраняется и отдаётся агентам сырой Markdown, а в простой текст он проецируется
// с потерями (блоки кода, адреса ссылок, HTML, подчёркивания). Заголовок и простой
// текст проверяем полным сканером; сырой Markdown — правилами известных форматов,
// проверкой пароля в адресе и полей с секретным именем. Находки склеиваем по хэшу
// значения. Проверяется только переданное: без content сохранённый текст не
// трогаем, без title — заголовок.
const secretReasons = (passed, ignoredHashes = []) => {
  // Проверяется копия без пометок портала (services/portalMarkers.js — ту же копию
  // видит скан сохранённой заметки агента); сохраняется текст как прислан
  const title = withoutMarkers(passed.title);
  const plainText = withoutMarkers(passed.plainText);
  const content = withoutMarkers(passed.content);
  const seen = new Set();
  const rawFindings = scanText(content, "content", ignoredHashes).filter((finding) => !HEURISTIC_CATEGORIES.has(finding.category));
  const reasons = [...scanNote({ title, plainText }, ignoredHashes), ...rawFindings]
    .filter((finding) => !seen.has(finding.hash) && seen.add(finding.hash))
    .map(
      (finding) =>
        `the ${finding.location} has a value that looks like a credential (${finding.category}: ${finding.maskedSnippet}): remove it or describe where it is kept instead`,
    );
  if (content === undefined) return reasons;
  if (hasUrlPassword(content)) {
    reasons.push("the content has a URL with a password in it (scheme://user:…@host): remove the password");
  }
  // У поля нет находки сканера и хэша: пометка модератора «не секрет» сюда не относится
  for (const line of secretFieldLines(content)) {
    reasons.push(`the content sets a secret-named field to a value on line ${line}: leave the line out, remove the value, or say where the value is kept instead`);
  }
  return reasons;
};

// Заметка с таким же заголовком уже есть: чем можем, помогаем, но скрытую не выдаём
const duplicateReason = (existing) => {
  if (!isServable(existing)) return "a note with this title already exists: choose another title";
  return isAgentNote(existing)
    ? `a note with this title already exists (id ${existing._id}): change it with update_knowledge_note`
    : `a note with this title already exists (id ${existing._id}) and was written by a person: choose another title`;
};

const describeSaved = (note, baseUrl) =>
  [
    `# ${note.title}`,
    `id: ${note._id}; type: ${TYPE_LABEL[note.type] || TYPE_LABEL.info}`,
    `companies: ${(note.companies || []).map((company) => company?.alias).filter(Boolean).join(", ") || "—"}; categories: ${(note.categories || []).map((category) => category?.title).filter(Boolean).join(", ") || "—"}`,
    `link: ${noteLink(baseUrl, note._id)}`,
    "status: unverified draft — a moderator will check it; agents can already find and read it.",
  ].join("\n");

/**
 * @param {object} deps
 * @param {object} deps.source чтение и запись заметок (knowledgeWriteSource.js)
 * @param {string} [deps.baseUrl] публичный адрес HD для ссылок (ADDRESS)
 * @param {(level: string, message: string, meta: object) => void} deps.log
 * @param {() => Date} [deps.now]
 */
const createKnowledgeWriteTools = ({ source, baseUrl, log, now = () => new Date() }) => {
  const withLock = createKeyLock();

  const logCall = (caller, tool, started, telegramId, fields) =>
    log("info", "MCP tool call", {
      mcpKeyId: caller?.keyId,
      mcpKeyName: caller?.keyName,
      tool,
      requester: String(telegramId || "").slice(-3),
      durationMs: Date.now() - started,
      ...fields,
    });

  // Человек за запросом: известен и вправе вести базу знаний
  const resolveRequester = async (requester, reasons) => {
    const telegramId = typeof requester === "number" ? String(requester) : String(requester ?? "");
    if (!TELEGRAM_ID.test(telegramId)) {
      reasons.push("requester must be the Telegram id of an employee (digits)");
      return { telegramId, person: null };
    }
    const person = await source.findRequester(telegramId);
    if (person?.error) reasons.push(person.error);
    else if (!person) reasons.push("no employee with this Telegram id: the person must be an active, non-deletedAt banned staff member with a linked Telegram");
    else if (!person.canManage) reasons.push("this person is not allowed to manage the knowledge base: ask someone who is");
    return { telegramId, person: person && !person.error && person.canManage ? person : null };
  };

  const resolveBindings = async (args, reasons) => {
    const wantsCompanies = args.companies !== undefined;
    const wantsCategories = args.categories !== undefined;
    if (!wantsCompanies && !wantsCategories) return {};
    const companies = wantsCompanies ? checkList("companies", args.companies, reasons) : null;
    const categories = wantsCategories ? checkList("categories", args.categories, reasons) : null;
    const directory = await source.loadDirectory();
    return {
      ...(companies ? { companyIds: resolveNames("company", companies, directory.companies, reasons) } : {}),
      ...(categories ? { categoryIds: resolveNames("category", categories, directory.categories, reasons) } : {}),
    };
  };

  const create = (args = {}, caller) =>
    withLock(`key:${caller?.keyId}`, async () => {
      const started = Date.now();
      const reasons = [];
      const { telegramId, person } = await resolveRequester(args.requester, reasons);
      const refuse = (kind) => {
        logCall(caller, "create_knowledge_note", started, telegramId, { outcome: `refused: ${kind}` });
        return refusal(reasons);
      };

      const title = checkTitle(args.title, reasons);
      const content = checkContent(args.content, reasons);
      if (args.type !== undefined && !NOTE_TYPES.includes(args.type)) reasons.push(`type must be one of: ${NOTE_TYPES.join(", ")}`);
      // Пока неизвестно, кто просит, справочник не читаем: имена компаний и
      // категорий из подсказок «Several … match» — не для постороннего
      const bindings = person ? await resolveBindings(args, reasons) : {};
      if (reasons.length) return refuse(person ? "input" : "requester");

      const plainText = markdownToPlainText(content);
      reasons.push(...secretReasons({ title, plainText, content }));
      if (reasons.length) return refuse("secret");

      const existing = (await source.listLiveNotes()).find((item) => titleKey(item.title) === titleKey(title));
      if (existing) {
        reasons.push(duplicateReason(existing));
        return refuse("duplicate");
      }

      const at = now();
      if ((await source.countCreatedSince(caller?.keyId, new Date(at.getTime() - DAY_MS))) >= DAILY_LIMIT) {
        reasons.push(`this key has already created ${DAILY_LIMIT} notes in the last 24 hours: update an existing note or try later`);
        return refuse("limit");
      }

      const note = await source.createNote({
        title,
        content,
        plainText,
        type: args.type || "info",
        companyIds: bindings.companyIds || [],
        categoryIds: bindings.categoryIds || [],
        requesterId: person._id,
        agent: { keyId: caller?.keyId, keyName: caller?.keyName, at },
      });
      logCall(caller, "create_knowledge_note", started, telegramId, { outcome: "created", noteId: String(note._id) });
      return textResult(describeSaved(note, baseUrl));
    });

  const update = (args = {}, caller) =>
    withLock(`key:${caller?.keyId}`, async () => {
      const started = Date.now();
      const noteId = String(args.id ?? "").trim();
      const reasons = [];
      const { telegramId, person } = await resolveRequester(args.requester, reasons);
      const done = (outcome, result) => {
        logCall(caller, "update_knowledge_note", started, telegramId, { outcome, noteId: noteId.slice(0, 64) });
        return result;
      };

      // Сначала человек: без него агент не узнаёт о заметке ничего (есть ли она,
      // чья), и справочник не читается
      if (!person) return done("refused: requester", refusal(reasons));

      const current = OBJECT_ID.test(noteId) ? await source.findForWrite(noteId) : null;
      // Скрытая, чужая-непроверенная, архивная и несуществующая — один ответ
      if (!isServable(current)) return done("refused: not found", errorResult(NOT_AVAILABLE));
      if (!isAgentNote(current)) return done("refused: human note", errorResult(HUMAN_NOTE));

      const patch = {};
      if (args.title !== undefined) patch.title = checkTitle(args.title, reasons);
      if (args.content !== undefined) patch.content = checkContent(args.content, reasons);
      if (args.type !== undefined) {
        if (NOTE_TYPES.includes(args.type)) patch.type = args.type;
        else reasons.push(`type must be one of: ${NOTE_TYPES.join(", ")}`);
      }
      Object.assign(patch, await resolveBindings(args, reasons));
      if (!reasons.length && !Object.keys(patch).length) reasons.push("nothing to change: pass title, content, type, companies or categories");
      if (reasons.length) return done("refused: input", refusal(reasons));

      // Проверяем только то, что меняется. Без content сохранённый текст не
      // перечитываем (его мог править человек) — смотрим один новый заголовок;
      // с content — новый текст и заголовок, новый или текущий.
      if (patch.content !== undefined) patch.plainText = markdownToPlainText(patch.content);
      const checked =
        patch.content !== undefined
          ? { title: patch.title ?? current.title, plainText: patch.plainText, content: patch.content }
          : { title: patch.title };
      reasons.push(...secretReasons(checked, current.secretsScan?.ignoredHashes || []));
      if (reasons.length) return done("refused: secret", refusal(reasons));

      if (patch.title !== undefined) {
        const existing = (await source.listLiveNotes()).find(
          (item) => String(item._id) !== String(current._id) && titleKey(item.title) === titleKey(patch.title),
        );
        if (existing) return done("refused: duplicate", refusal([duplicateReason(existing)]));
      }

      const note = await source.updateNote(noteId, { ...patch, requesterId: person._id });
      return done("updated", textResult(describeSaved(note, baseUrl)));
    });

  return { create, update };
};

// secretFields — наружу ради тестов: заглушку password=[скрыто] правило сканера
// generic-api-key само считает значением, и через create правило полей не проверить
module.exports = { createKnowledgeWriteTools, secretFields, DAILY_LIMIT, MAX_TITLE, MAX_CONTENT, MAX_BINDINGS };
