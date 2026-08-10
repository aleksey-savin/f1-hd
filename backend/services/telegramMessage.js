/**
 * Сборка текстов telegram-уведомлений.
 *
 * До этого двадцать шаблонов лежали строками прямо в `middleware/notifications`,
 * причём девять из них — дословными дублями (один текст на три вида получателей).
 * Правка формата означала двадцать одинаковых правок, и они разъезжались.
 *
 * ПРАВИЛА, из которых собран каждый текст (согласовано макетом):
 *
 * 1. Первая строка всегда `<эмодзи> <b>что произошло</b> · #ticket_N`. Хештег
 *    виден сразу и тапается, не дожидаясь конца сообщения; номер больше нигде
 *    не повторяется.
 * 2. Жирным — ОДНО на сообщение: тема заявки. Плюс изменившееся значение там,
 *    где событие про изменение. Раньше жирным было набрано до пяти строк из
 *    шести, то есть не выделено ничего.
 * 3. Текст, написанный ЧЕЛОВЕКОМ, — всегда цитата: комментарий, причина
 *    возврата, закрывающий комментарий, отказ. Это и отличает комментарий от
 *    записи о событии на скорости пролистывания, ещё до чтения.
 * 4. Подписи «Тема:», «Компания:», «Инициатор:» убраны — значения узнаются без
 *    них. Подпись остаётся там, где без неё неоднозначно (срок, исполнитель).
 *
 * Приглушённого текста в Telegram НЕТ: разметка знает только жирный, курсив,
 * моноширинный, спойлер и цитату. Поэтому иерархия строится на «жирное против
 * обычного», а не на оттенках серого.
 */

/**
 * Экранирование обязательно и не обсуждается.
 *
 * Тема заявки, комментарий и имена приходят от людей и уходят в HTML. Один
 * символ `<` в теме — и Telegram отбивает СООБЩЕНИЕ ЦЕЛИКОМ: уведомление не
 * доходит вовсе, а в журнале остаётся только «can't parse entities». Раньше
 * подстановка шла сырой.
 */
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Порог сворачивания цитаты. Три-четыре строки читаются на месте; переписка на
 * десять реплик не должна занимать экран, поэтому длинное Telegram сворачивает
 * сам (`expandable`, Bot API 7.4) и показывает «Развернуть».
 */
const QUOTE_EXPAND_AT = 200;

/** Речь человека. Пустой текст цитаты не даёт — пустая полоса выглядит сбоем. */
const quote = (text) => {
  const clean = escapeHtml(text).trim();
  if (!clean) return null;
  return `<blockquote${clean.length > QUOTE_EXPAND_AT ? " expandable" : ""}>${clean}</blockquote>`;
};

/** «Фамилия Имя», без двойных пробелов, если одного из полей нет. */
const personName = (person) =>
  `${person?.lastName || ""} ${person?.firstName || ""}`.trim();

/** «ООО «Ромашка» · Иванова Мария» — контекст одной строкой. */
const contextLine = (ticket) =>
  [ticket?.company?.alias, personName(ticket?.applicantId)]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ") || null;

/**
 * Уведомление о событии заявки.
 *
 * @param {object}   args
 * @param {string}   args.emoji   значок события
 * @param {string}   args.event   что произошло, в первой строке
 * @param {object}   args.ticket  заявка (нужны num и title)
 * @param {string}   [args.quoted] текст человека — уйдёт в цитату
 * @param {string[]} [args.lines]  дополнительные строки (уже экранированные)
 */
const ticketEvent = ({ emoji, event, ticket, quoted, lines = [] }) => {
  const parts = [
    `${emoji} <b>${escapeHtml(event)}</b> · #ticket_${ticket.num}`,
    `<b>${escapeHtml(ticket.title)}</b>`,
  ];

  // Цитата идёт сразу за темой: это самое важное в сообщении после неё.
  const quoteBlock = quote(quoted);
  if (quoteBlock) parts.push(quoteBlock);

  parts.push(...lines.filter(Boolean));

  return parts.join("\n");
};

/**
 * Уведомление о комментарии — СВОЯ форма, и в этом весь смысл.
 *
 * Начинается с человека, а не со служебного «Комментарий к заявке N», и почти
 * целиком состоит из цитаты. Тема заявки уходит вниз контекстом: получатель уже
 * знает, о чём заявка, ему важно, что именно написали.
 */
const commentEvent = ({ comment, ticket }) => {
  const parts = [
    `💬 <b>${escapeHtml(personName(comment.createdBy))}</b> · #ticket_${ticket.num}`,
  ];

  const quoteBlock = quote(comment.content);
  if (quoteBlock) parts.push(quoteBlock);

  parts.push(escapeHtml(ticket.title));

  return parts.join("\n");
};

/**
 * Уведомление о запланированных работах — единственное, что относится сразу к
 * НЕСКОЛЬКИМ заявкам, поэтому хештегов в первой строке столько же.
 *
 * Прежняя версия собирала их так: `${tickets.map((t) => t + " ")}` — то есть
 * подставляла в строку МАССИВ, а он склеивается запятыми. В чат уходило
 * «#ticket_51713 ,#ticket_51714» с лишней запятой; то же самое было и в
 * перечислении номеров.
 */
const worksEvent = ({ emoji, event, tickets, lines = [] }) =>
  [
    `${emoji} <b>${escapeHtml(event)}</b> · ${tickets
      .map((num) => `#ticket_${num}`)
      .join(" ")}`,
    ...lines.filter(Boolean),
  ].join("\n");

module.exports = {
  escapeHtml,
  quote,
  personName,
  contextLine,
  ticketEvent,
  commentEvent,
  worksEvent,
  QUOTE_EXPAND_AT,
};
