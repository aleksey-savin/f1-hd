const { redactSecrets } = require("../secretsScanner");

/**
 * Вычистка `.rsc`-экспорта RouterOS перед отдачей ИИ-агенту (MCP). Сохранённые
 * экспорты этой функцией не трогаются — она работает с копией в памяти.
 *
 * Слои (docs/mcp.md «Mikrotik tools»):
 *   1. значение поля-секрета заменяется на «[секрет скрыт]»;
 *   2. неизвестное поле с key/pass/secret/psk/token/community в имени — тоже
 *      (fail-closed), кроме явного списка публичного;
 *   3. разделы с учётками отдаются только именами;
 *   4. тела скриптов заменяются заглушкой;
 *   5. свободный текст (comment и т. п.) проходит общий сканер секретов;
 *   6. строка, которую не удалось разобрать, скрывается целиком.
 */

const SECRET = "[секрет скрыт]";
const HIDDEN = "[скрыто]";
const UNPARSED = "[строка скрыта: не удалось разобрать]";

// Имена полей без «говорящей» подстроки, которые всё равно секрет.
const SECRET_FIELDS = new Set(["passcode", "cak"]);
// «pin» отдельным словом имени: pin, sim-pin, pin-number (но не ping, не spinning)
const PIN_NAME = /(^|[-.])pin([-.]|$)/;
const SECRET_NAME = /key|pass|secret|psk|token|community/;
// Публичное с «key»/«pass» в имени — показывается как есть.
const PUBLIC_FIELDS = new Set([
  "public-key",
  "key-size",
  "key-type",
  "key-usage",
  "key-id",
  "authentication-key-id",
  "host-key-size",
  "host-key-type",
  "group-key-update",
  "passthrough",
  "passive",
]);

// Поля, в которых живёт код RouterOS: в нём часто зашиты пароли и токены.
const SCRIPT_FIELDS = new Set([
  "source",
  "script",
  "on-event",
  "on-up",
  "on-down",
  "on-login",
  "on-logout",
  "on-error",
  "up-script",
  "down-script",
  "test-script",
  "lease-script",
]);

// Обработчики событий RouterOS называются on-<событие> (on-alert, on-message…):
// новое имя не должно требовать правки списка.
const isScriptField = (name) => SCRIPT_FIELDS.has(name) || name.startsWith("on-");

// Учётные данные внутри адреса: scheme://user:password@host
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@"]+@/gi;
const scrubUrls = (value) => {
  let count = 0;
  const text = value.replace(URL_CREDENTIALS, (match, scheme) => {
    count += 1;
    return `${scheme}${HIDDEN}@`;
  });
  return { text, count };
};

// Свободный текст, который пишет человек, — через общий сканер секретов.
const FREE_TEXT_FIELDS = new Set(["comment", "note", "description", "contact", "location", "label"]);

// Разделы с учётками: остаются только перечисленные поля. У SNMP имя
// community и есть секрет, поэтому там не остаётся и оно.
const NAMES_ONLY_KEEP = new Set(["name", "comment", "disabled", "group", "profile", "service"]);
const SNMP_KEEP = new Set(["comment", "disabled"]);
const namesOnlyRule = (section) => {
  if (section === "/snmp community") return SNMP_KEEP;
  if (
    section === "/user" ||
    section.startsWith("/user ssh-keys") ||
    section === "/ppp secret" ||
    section === "/ip hotspot user" ||
    section.startsWith("/certificate") ||
    section.startsWith("/user-manager") ||
    section.startsWith("/tool user-manager")
  ) {
    return NAMES_ONLY_KEEP;
  }
  return null;
};

// Секрет под обычным именем поля — только в своём разделе.
const SECTION_SECRET_FIELDS = [
  [/^\/zerotier/, new Set(["identity"])],
  [/^\/container envs/, new Set(["value"])],
];

const isSecretField = (section, name) => {
  if (PUBLIC_FIELDS.has(name)) return false;
  if (SECRET_FIELDS.has(name) || SECRET_NAME.test(name) || PIN_NAME.test(name)) return true;
  return SECTION_SECRET_FIELDS.some(([path, fields]) => path.test(section) && fields.has(name));
};

// Экспорт переносит длинные строки: «\» в конце и отступ на следующей. Чётное
// число слешей в конце — экранированный слеш, а не перенос.
//
// Пока кавычка открыта, конец физической строки — всегда перенос: значение в
// кавычках не содержит настоящих переводов строки. Иначе перенос, попавший
// внутрь «\n», оставил бы хвост скрипта отдельной строкой вне кавычек.
const quoteOpenAfter = (piece, open) => {
  let inQuote = open;
  for (let index = 0; index < piece.length; index += 1) {
    const char = piece[index];
    if (inQuote && char === "\\") index += 1;
    else if (char === '"') inQuote = !inQuote;
  }
  return inQuote;
};

const joinContinuations = (text) => {
  const lines = [];
  let pending = null;
  let inQuote = false;
  for (const raw of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    // Комментарий экспорта — отдельная строка, кавычки в нём ничего не значат
    if (pending === null && raw.trimStart().startsWith("#")) {
      lines.push(raw);
      continue;
    }
    const added = pending === null ? raw : raw.replace(/^\s+/, "");
    const piece = pending === null ? added : pending + added;
    inQuote = quoteOpenAfter(added, inQuote);
    const trailing = piece.length - piece.replace(/\\+$/, "").length;
    if (trailing % 2 === 1) pending = piece.slice(0, -1);
    else if (inQuote) pending = piece;
    else {
      lines.push(piece);
      pending = null;
    }
  }
  if (pending !== null) lines.push(pending);
  return lines;
};

const FIELD_NAME = /[A-Za-z0-9][A-Za-z0-9._-]*=/y;
const isBoundary = (char) => char === undefined || char === " " || char === "\t" || char === "[" || char === "(";

// Конец значения с позиции from: в кавычках — до закрывающей (с учётом «\"»),
// без кавычек — до пробела или «]». -1 — кавычка не закрыта.
const valueEnd = (line, from) => {
  if (line[from] !== '"') {
    let index = from;
    while (index < line.length && !/[\s\]]/.test(line[index])) index += 1;
    return index;
  }
  let index = from + 1;
  while (index < line.length) {
    if (line[index] === "\\") index += 2;
    else if (line[index] === '"') return index + 1;
    else index += 1;
  }
  return -1;
};

const scriptStub = (value) => `"[скрипт скрыт: ${value.split("\\n").length} строк]"`;

const redactValue = (section, keep, name, value) => {
  if (keep) return keep.has(name) && !isSecretField(section, name) ? null : HIDDEN;
  if (isSecretField(section, name)) return SECRET;
  if (isScriptField(name)) return scriptStub(value);
  return null;
};

// Одна логическая строка раздела → строка для агента и число скрытых значений.
const redactLine = (section, line) => {
  const keep = namesOnlyRule(section);
  let out = "";
  let hidden = 0;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === '"') {
      // Значение в кавычках вне пары «поле=значение» (аргумент команды)
      const end = valueEnd(line, index);
      if (end < 0) return { text: UNPARSED, hidden: 1 };
      out += line.slice(index, end);
      index = end;
      continue;
    }
    FIELD_NAME.lastIndex = index;
    const field = isBoundary(line[index - 1]) ? FIELD_NAME.exec(line) : null;
    if (!field) {
      out += char;
      index += 1;
      continue;
    }
    const name = field[0].slice(0, -1).toLowerCase();
    const start = index + field[0].length;
    const end = valueEnd(line, start);
    if (end < 0) return { text: UNPARSED, hidden: 1 };
    const value = line.slice(start, end);
    const replaced = redactValue(section, keep, name, value);
    if (replaced !== null) {
      hidden += 1;
      out += `${field[0]}${replaced}`;
    } else if (FREE_TEXT_FIELDS.has(name)) {
      const scanned = redactSecrets(scrubUrls(value).text);
      hidden += scanned.count;
      out += `${field[0]}${scanned.text}`;
    } else {
      const scrubbed = scrubUrls(value);
      hidden += scrubbed.count;
      out += field[0] + scrubbed.text;
    }
    index = end;
  }
  return { text: out, hidden };
};

// «/ip firewall filter» или однострочная форма «/ip address add address=…»:
// путь раздела — слова до команды.
const COMMAND = /^(add|set|remove|enable|disable|unset)$/;
const splitSectionLine = (line) => {
  const words = line.trim().split(/\s+/);
  const at = words.findIndex((word, index) => index > 0 && (COMMAND.test(word) || word.includes("=")));
  if (at < 0) return { path: words.join(" "), rest: "" };
  return { path: words.slice(0, at).join(" "), rest: words.slice(at).join(" ") };
};

/**
 * @param {string|Buffer} raw текст `/export`
 * @returns {{ header: string[], sections: { path: string, lines: string[] }[], hidden: number }}
 *   header — строки-комментарии до первого раздела (версия, модель, серийник);
 *   разделы — в порядке первого появления, одноимённые склеены.
 */
const redactConfig = (raw) => {
  const header = [];
  const sections = [];
  const byPath = new Map();
  let hidden = 0;
  let current = null;

  const open = (path) => {
    current = byPath.get(path);
    if (!current) {
      current = { path, lines: [] };
      byPath.set(path, current);
      sections.push(current);
    }
  };
  const push = (line) => {
    const result = redactLine(current.path, line);
    hidden += result.hidden;
    current.lines.push(result.text);
  };

  for (const rawLine of joinContinuations(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if (current) current.lines.push(line);
      else header.push(line);
      continue;
    }
    if (line.startsWith("/")) {
      const { path, rest } = splitSectionLine(line);
      open(path);
      if (rest) push(rest);
      continue;
    }
    // Строка до первого раздела — не экспорт (ошибка команды и т. п.)
    if (!current) open("/");
    push(line);
  }
  return { header, sections, hidden };
};

// Первая содержательная строка экспорта — комментарий или раздел; иное значит,
// что роутер ответил ошибкой команды.
const looksLikeExport = (raw) => {
  const text = (Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "")).trimStart();
  return text.startsWith("#") || text.startsWith("/");
};

module.exports = {
  redactConfig,
  looksLikeExport,
  isSecretField,
  isScriptField,
  SCRIPT_FIELDS,
  PUBLIC_FIELDS,
  scrubUrls,
  FREE_TEXT_FIELDS,
  SECRET,
  HIDDEN,
};
