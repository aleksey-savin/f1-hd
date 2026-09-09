// Снимает HTML-теги и базовые entity, оставляя текст для глобального поиска.
// Всё вместе одной строкой: поиску переводы строк не нужны, а лишние пробелы
// мешают. Где строки важны (Telegram) — `htmlToPlainLines` ниже.
module.exports.htmlToPlainText = (html = "") => {
  if (!html || typeof html !== "string") {
    return "";
  }

  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * То же, но с сохранением строк: блочные теги и `<br>` становятся переводами
 * строк. Нужно там, где текст читают человеческими глазами, а разметку
 * переслать нельзя, — в Telegram: он понимает горстку тегов, а `<p>` роняет
 * всю отправку ошибкой разбора. Без переводов строк собранное из ответов
 * описание («ФИО: …», «Пропуск: …») склеилось бы в одну строку.
 *
 * Близнец `plainText` в tg-service (`src/bot/text.ts`): у сервиса своей копии
 * бэкенда нет, а карточку заявки он рисует сам.
 *
 * @param {string} html разметка описания или комментария
 * @param {number} [limit] предел длины; 0 — не обрезать
 * @returns {string}
 */
module.exports.htmlToPlainLines = (html = "", limit = 0) => {
  if (!html || typeof html !== "string") {
    return "";
  }

  const text = html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // Амперсанд — последним, иначе «&amp;lt;» развернулся бы в тег
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (!limit || text.length <= limit) {
    return text;
  }

  // Многоточие входит в лимит, а не прибавляется к нему (как у deriveTicketTitle)
  const clipped = text.slice(0, limit - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const body = lastSpace > limit / 2 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
};
