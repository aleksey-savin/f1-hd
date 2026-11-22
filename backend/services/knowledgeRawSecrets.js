const { isSecretField } = require("./mikrotik/secretFields");

const HEURISTIC_CATEGORIES = new Set(["password-near-keyword", "password-like", "high-entropy-token"]);

// Пароль внутри адреса: scheme://user:password@host (как в mikrotik/configRedact.js).
// Одной регулярной `схема://[^:]+:[^@]+@` здесь нельзя: на 40 000 букв без «://» она
// от каждой позиции заново читала «схему» до конца текста — 1,4 с на вызов, а MCP
// делит цикл событий с веб-приложением. Идём по «://»: слева — знак схемы, справа —
// липкая проверка с потолком длины; «/» обрывает её не дальше следующего «://».
// Логин может быть пустым: пометка портала на его месте («ftp://[e-mail]:пароль@…»)
// из проверяемой копии исчезает, а пароль остаётся.
const SCHEME_CHAR = /[a-z0-9+.-]/i;
const URL_USERINFO = /[^\s/@:]{0,256}:[^\s/@]{1,256}@/y;
const hasUrlPassword = (text) => {
  let at = text.indexOf("://");
  while (at !== -1) {
    if (at > 0 && SCHEME_CHAR.test(text[at - 1])) {
      URL_USERINFO.lastIndex = at + 3;
      if (URL_USERINFO.test(text)) return true;
    }
    at = text.indexOf("://", at + 3);
  }
  return false;
};

// Поле с секретным именем и значением: private-key="…", wpa2-pre-shared-key=…,
// password=… В блоке кода его не видит ни простой текст (блоки в него не попадают),
// ни правила известных форматов. Какое имя секретное, решает mikrotik/configRedact.js
// (там же список публичного: public-key и т. п.). Весь redactConfig не зовём: он
// прячет ещё скрипты, комментарии и разделы учёток — безобидная заметка получила бы
// отказ.
//
// Идём по «=»: имя — знаки слева, не дальше MAX_FIELD_NAME; от значения смотрим
// только начало (VALUE_PEEK) — на вопрос «пусто или заглушка» этого хватает, и
// «a=a=a=…» не заставляет читать текст до конца от каждого «=».
const MAX_FIELD_NAME = 64;
const MAX_FIELD_PAD = 16;
const VALUE_PEEK = 128;
const MAX_FIELD_REASONS = 5;
const isFieldNameChar = (code) =>
  (code >= 48 && code <= 57) || // 0-9
  (code >= 65 && code <= 90) || // A-Z
  (code >= 97 && code <= 122) || // a-z
  code === 45 || // -
  code === 46 || // .
  code === 95; // _
const QUOTES = new Set(["`", "'", '"']);
// Знаки, сразу за которыми может начинаться имя поля: открывающие скобки, «;»
// (разделитель команд RouterOS) и «?», «&» — параметры в адресе
const BRACKETS = new Set(["(", "[", "{"]);
const NAME_SEPARATORS = new Set([";", "?", "&"]);
const WHITESPACE = /\s/;
const TRAILING = new Set(["`", "'", '"', ",", ";", ".", ")", "|", "*"]);
// Заглушка вместо значения: [скрыто], <спросить у администратора>, {{wireguard.public-key}}
const PLACEHOLDERS = [
  ["[", "]"],
  ["<", ">"],
  ["{{", "}}"],
];
const MASK_ONLY = /^[*•…]+$/;
// Слова-переключатели RouterOS: секретом такое значение быть не может
// (always-allow-password-login=yes). Больше ничего не освобождается:
// trap-community=public и key=value остаются отказом.
const SWITCH_WORDS = new Set(["yes", "no", "true", "false", "auto", "none", "default", "enabled", "disabled"]);

// spaced — «Имя = значение» (wg-quick, INI): пробелы после «=» пропускаем. Только
// когда пробел есть и перед «=»: «…Q= user@host» — конец base64, а не поле
const hasFieldValue = (text, from, spaced) => {
  const peek = text.slice(from, from + VALUE_PEEK);
  let start = 0;
  while (spaced && start < peek.length && (peek[start] === " " || peek[start] === "\t")) start += 1;
  while (start < peek.length && QUOTES.has(peek[start])) start += 1;
  let lineEnd = start;
  while (lineEnd < peek.length && peek[lineEnd] !== "\n" && peek[lineEnd] !== "\r") lineEnd += 1;
  const line = peek.slice(start, lineEnd);
  // Заглушка бывает с пробелами — до закрывающей скобки на той же строке; дальше
  // смотрим то, что идёт за ней: «[x]R00tP@ss» — значение, а не заглушка
  let from0 = 0;
  for (const [open, close] of PLACEHOLDERS) {
    const closeAt = line.startsWith(open) ? line.indexOf(close, open.length) : -1;
    if (closeAt !== -1) from0 = closeAt + close.length;
  }
  let end = from0;
  while (end < line.length && line[end] !== " " && line[end] !== "\t") end += 1;
  while (end > from0 && TRAILING.has(line[end - 1])) end -= 1;
  const value = line.slice(from0, end);
  return Boolean(value) && !MASK_ONLY.test(value) && !SWITCH_WORDS.has(value.toLowerCase());
};

// PrivateKey → private-key: имя приводим к виду RouterOS, тогда isSecretField знает
// и исключения (PublicKey → public-key — публичное)
const kebabName = (raw) =>
  raw
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/^[._-]+/, "");

// Имя поля начинается от границы: начало текста, пробельный знак (в том числе
// перевод строки), открывающая скобка или разделитель — возможно, через кавычки
// («"password=…"» после пробела или в скобках). Серия, перед которой «=» — сразу,
// через кавычки или через открывающие скобки («p="X=2"», «p=(X=2)»), — значение
// предыдущего поля: «p=MyS3cretPass=2». Такую серию нельзя ни считать полем, ни
// показывать в отказе — это кусок чужого значения. Серии кавычек и скобок перед
// разными «=» не пересекаются, так что проход остаётся линейным.
const startsAtBoundary = (text, start) => {
  let at = start;
  let bracket = false;
  while (at > 0 && (QUOTES.has(text[at - 1]) || BRACKETS.has(text[at - 1]))) {
    bracket = bracket || BRACKETS.has(text[at - 1]);
    at -= 1;
  }
  if (at === 0) return true;
  const before = text[at - 1];
  if (before === "=") return false;
  return bracket || WHITESPACE.test(before) || NAME_SEPARATORS.has(before);
};

// Секретные поля, которым в тексте задано значение: по одному на ключ keyOf (имя
// или номер строки), не больше MAX_FIELD_REASONS. Номер строки — с единицы, в
// тексте как он прислан: переводы строк считаются по ходу, от прошлого «=» до
// текущего, без повторного чтения с начала.
const fieldHits = (content, keyOf) => {
  const text = String(content ?? "");
  const keys = [];
  let line = 1;
  let nextBreak = text.indexOf("\n"); // ближайший ещё не сосчитанный перевод строки
  let at = text.indexOf("=");
  while (at !== -1 && keys.length < MAX_FIELD_REASONS) {
    while (nextBreak !== -1 && nextBreak < at) {
      line += 1;
      nextBreak = text.indexOf("\n", nextBreak + 1);
    }
    // «Имя = значение»: пробелы и табуляция перед «=» (не дальше MAX_FIELD_PAD)
    let nameEnd = at;
    while (nameEnd > 0 && at - nameEnd < MAX_FIELD_PAD && (text[nameEnd - 1] === " " || text[nameEnd - 1] === "\t")) nameEnd -= 1;
    let start = nameEnd;
    while (start > 0 && nameEnd - start < MAX_FIELD_NAME && isFieldNameChar(text.charCodeAt(start - 1))) start -= 1;
    // Длиннее потолка или «==» — не имя поля, а хвост base64
    const blob = (start > 0 && isFieldNameChar(text.charCodeAt(start - 1))) || text[at + 1] === "=";
    const name = blob || !startsAtBoundary(text, start) ? "" : kebabName(text.slice(start, nameEnd));
    const key = name ? keyOf({ name, line }) : undefined;
    if (name && !keys.includes(key) && isSecretField("", name) && hasFieldValue(text, at + 1, nameEnd < at)) keys.push(key);
    at = text.indexOf("=", at + 1);
  }
  return keys;
};

// Имена — только для тестов правила; в отказ уходят номера строк. Имя берётся из
// текста агента, и кусок значения, принятый за имя («Comment = MyS3cretPass=2»),
// вернулся бы в ответе: отказ не повторяет ничего из присланного.
const secretFields = (content) => fieldHits(content, (hit) => hit.name);
const secretFieldLines = (content) => fieldHits(content, (hit) => hit.line);

module.exports = { HEURISTIC_CATEGORIES, hasUrlPassword, secretFields, secretFieldLines };
