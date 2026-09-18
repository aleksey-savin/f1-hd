const { htmlToPlainLines } = require("../../helpers/htmlToPlainText");
const { stripQuotedReply } = require("../emailReplyStripper");

// Общие текстовые помощники MCP-инструментов (база знаний и заявки).

const SNIPPET_BEFORE = 100;
const SNIPPET_AFTER = 200;

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е");

// Кусок текста вокруг первого совпадения — чтобы агент видел, чем запись
// подошла, не открывая её. Всегда одна строка: снипет стоит в строке списка
// результатов, и переносы из чужого текста ломали бы её вёрстку.
const buildSnippet = (text, needles) => {
  const source = String(text || "");
  const haystack = normalize(source);
  const positions = needles
    .map((needle) => haystack.indexOf(needle))
    .filter((index) => index >= 0);
  const at = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(source.length, at + SNIPPET_AFTER);
  const piece = source.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${piece}${end < source.length ? "…" : ""}`;
};

// base64-вставки (картинки из редактора, файлы в письмах) — агенту от них
// только расход контекста.
const DATA_URI = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;

// Момент — полным ISO: агент сам переведёт в пояс собеседника, а обрезка до
// даты сдвигает день (docs/datetime-conventions.md).
const iso = (value) => (value ? new Date(value).toISOString() : "—");

// После имени тега обязан идти ">", "/>" или пробел (атрибуты) — иначе
// «Имя <e@x.ru>:» из цитаты почтового клиента считается тегом ("e" — имя тега).
const HTML_TAG = /<\/?[a-z][a-z0-9]*(?:\/?>|\s[^>]*>)/i;

// Сколько слов запроса ищем подстрокой, когда основ нет (IP, номера, srv-dc01).
const MAX_FALLBACK_TERMS = 8;

/** Слова запроса для поиска подстрокой — так ищут и база знаний, и заявки. */
const fallbackTerms = (query) =>
  normalize(query).split(/\s+/).filter(Boolean).slice(0, MAX_FALLBACK_TERMS);

/** Каждое слово запроса есть в тексте; пустой список слов не совпадает ни с чем. */
const hasAllTerms = (text, terms) => {
  const haystack = normalize(text);
  return terms.length > 0 && terms.every((term) => haystack.includes(term));
};

/**
 * Текст заявки для агента и для поиска: HTML редактора — в строки, у писем
 * срезана цитата прошлой переписки (подпись остаётся — её контакты закроет
 * maskText), base64-вставки убраны. htmlDescription (сырое письмо) не читается.
 */
const ticketPlainText = (ticket) => {
  const raw = String(ticket?.description || "");
  let text = HTML_TAG.test(raw) ? htmlToPlainLines(raw) : raw.replace(/\r\n/g, "\n");
  if (ticket?.source === "Почта") {
    text = stripQuotedReply(text).content;
  }
  return text.replace(DATA_URI, "[данные]").trim();
};

module.exports = { normalize, buildSnippet, iso, DATA_URI, ticketPlainText, fallbackTerms, hasAllTerms };
