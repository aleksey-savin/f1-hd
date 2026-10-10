// Текст команд RouterOS для человека (утверждение) и сборка предложения API. Чистый модуль: без моделей, логов и ввода-вывода.
// Ничего из собранного здесь не набирается в консоли; исполнение — только через apiWords.
// Экранирование в показываемой строке — граница достоверности: значение читается ровно одним значением.
const { PLACEHOLDERS } = require("./changeRules");

const MARKER = "‹создаст HD›";
const BARE = /^[A-Za-z0-9_.:/,@-]+$/;
const PATH = /^\/[a-z0-9-]+( [a-z0-9-]+)*$/i;
const FIELD = /^[a-z0-9][a-z0-9.-]*$/;
const PLACEHOLDER = /\{\{[^}]*\}\}/;
const KNOWN = new Set(Object.values(PLACEHOLDERS));
const ACTIONS = ["add", "set", "remove", "enable", "disable"];

// Запрещены: C0/DEL/C1, bidi-управление, нулевая ширина и метки направления, разделители строк, BOM.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u061c\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;
const hasForbiddenChars = (value) => FORBIDDEN.test(value);
// В where голым остаётся только строгий литерал: иначе слово читается как выражение.
const WHERE_BARE = /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|\d+|yes|no|true|false)$/;
const ID = /^\*[0-9A-Fa-f]+$/;

function checkString(value) {
  if (typeof value !== "string") throw new Error("value must be a string");
  if (hasForbiddenChars(value)) throw new Error("value contains a forbidden character");
  if (value === MARKER) throw new Error("value equals the display marker");
}

function quoteValue(value) {
  checkString(value);
  return quoteWith(value, BARE);
}

function quoteWith(value, bare) {
  checkString(value);
  if (value !== "" && bare.test(value)) return value;
  return `"${value.replace(/[\\"$?]/g, "\\$&")}"`;
}

// Подстановка → настоящее значение; остаток «{{…}}» — ошибка.
function resolve(value, values) {
  if (typeof value === "string" && KNOWN.has(value) && Object.prototype.hasOwnProperty.call(values, value)) {
    return values[value];
  }
  if (typeof value === "string" && PLACEHOLDER.test(value)) throw new Error(`unresolved placeholder in ${JSON.stringify(value)}`);
  return value;
}

function pairs(object, toText, bareOk) {
  return Object.entries(object || {}).map(([name, value]) => {
    if (!FIELD.test(name)) throw new Error(`unsafe field name ${JSON.stringify(name)}`);
    return `${name}=${toText(value, bareOk)}`;
  });
}

function build(command, toText) {
  if (!command || typeof command.path !== "string" || !PATH.test(command.path)) throw new Error("unsafe path");
  if (!ACTIONS.includes(command.action)) throw new Error(`unknown action ${JSON.stringify(command.action)}`);
  const parts = [`${command.path} ${command.action}`];
  if (command.action !== "add") {
    const where = pairs(command.where, toText, WHERE_BARE);
    if (!where.length) throw new Error(`${command.action} requires a where`);
    parts.push(`[find where ${where.join(" ")}]`);
  }
  parts.push(...pairs(command.params, toText, BARE));
  return parts.join(" ");
}

function renderCommand(command, { values = {} } = {}) {
  return build(command, (value, bare) => quoteWith(resolve(value, values), bare));
}

// Для человека: подстановка показана маркером и не бросает; на невалидном вводе бросает.
function displayCommand(command) {
  return build(command, (value, bare) => (KNOWN.has(value) ? MARKER : quoteWith(value, bare)));
}

const BOOL = { true: "yes", false: "no" };
const norm = (v) => (Object.hasOwn(BOOL, String(v)) ? BOOL[String(v)] : String(v));

function diffRows(command, before) {
  if (!command || command.action !== "set") return [];
  const rows = [];
  for (const [field, to] of Object.entries(command.params || {})) {
    const from = before && before[field] !== undefined && before[field] !== null ? String(before[field]) : "";
    if (norm(from) !== norm(to)) rows.push({ field, from, to: String(to) });
  }
  return rows;
}

// Предложение API RouterOS: where сюда не попадает, строка определяется по .id.
function apiWords(command, { id = null, values = {} } = {}) {
  if (!command || typeof command.path !== "string" || !PATH.test(command.path)) throw new Error("unsafe path");
  if (!ACTIONS.includes(command.action)) throw new Error(`unknown action ${JSON.stringify(command.action)}`);
  const words = [`${command.path.replace(/ /g, "/")}/${command.action}`];
  if (command.action === "add") {
    if (id !== null) throw new Error("id must be null for add");
  } else {
    if (typeof id !== "string" || !ID.test(id)) throw new Error("id is required and must look like *1A");
    words.push(`=.id=${id}`);
  }
  if (command.action === "set" && !Object.keys(command.params || {}).length) throw new Error("set requires params");
  if (command.action === "add" || command.action === "set") {
    for (const [name, value] of Object.entries(command.params || {})) {
      if (!FIELD.test(name)) throw new Error(`unsafe field name ${JSON.stringify(name)}`);
      const real = resolve(value, values);
      checkString(real);
      words.push(`=${name}=${real}`);
    }
  }
  return words;
}

module.exports = { quoteValue, renderCommand, displayCommand, diffRows, hasForbiddenChars, apiWords };
