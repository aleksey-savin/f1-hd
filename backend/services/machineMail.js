/**
 * Письмо написал робот, а не человек.
 *
 * Зачем: ответ на закрытую заявку поднимает её перед ответственным («клиент
 * ответил после закрытия»). Автоответчик, список рассылки и отбойник о
 * недоставке поднимать не должны — иначе первая же заявка «настроить автоответ»
 * начинает дёргать человека собственным автоответом, ради которого её и
 * заводили.
 *
 * Как: только заголовки, никаких догадок по тексту. Набор стандартный, его
 * используют все почтовые системы, чтобы не зациклиться на автоответах:
 *
 *   • `Auto-Submitted` (RFC 3834) — единственный однозначный маркер. У живого
 *     письма он либо отсутствует, либо равен `no`;
 *   • `X-Autoreply` / `X-Autorespond` — до-RFC-овские, но живее всех живых;
 *   • `Precedence: bulk | junk | list | auto_reply` — рассылки и автоматика;
 *   • `List-Id` / `List-Unsubscribe` — письмо из списка рассылки, ответом на
 *     заявку оно не бывает;
 *   • пустой `Return-Path: <>` — конверт без обратного адреса. Так шлют
 *     отбойники о недоставке и значительная часть автоответчиков: пустой
 *     конверт как раз и означает «на это письмо отвечать некому».
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: разбора смысла. «Спасибо!» и «вы ничего не
 * сделали» отличаются намерением, а не формой, и списки слов ошибаются в обе
 * стороны — причём дорогая сторона одна: принять живую претензию за вежливость.
 * Поэтому ошибаться этот модуль может только в безопасную сторону — пропустить
 * робота, но никогда не записать человека в роботы.
 *
 * `X-Auto-Response-Suppress` намеренно не в списке: его ставит ОТПРАВИТЕЛЬ,
 * прося не отвечать ему автоматически, и живые письма из Outlook несут его
 * сплошь и рядом.
 */

/** Заголовок строкой, что бы mailparser туда ни положил. */
const headerText = (headers, name) => {
  const value = headers?.get?.(name);
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  // Адресные заголовки приезжают объектом `{ value: [...], text: "<>" }`
  if (typeof value.text === "string") return value.text.trim();
  if (Array.isArray(value)) return value.join(" ").trim();
  return String(value).trim();
};

const has = (headers, name) => headerText(headers, name) !== "";

/**
 * @param {object} mail — разобранное письмо (`mailparser.simpleParser`).
 * @returns {boolean} писал робот.
 */
const isMachineMail = (mail) => {
  const headers = mail?.headers;
  if (!headers?.get) return false;

  const autoSubmitted = headerText(headers, "auto-submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;

  if (has(headers, "x-autoreply") || has(headers, "x-autorespond")) return true;

  if (/^(bulk|junk|list|auto_reply)$/i.test(headerText(headers, "precedence"))) {
    return true;
  }

  if (has(headers, "list-id") || has(headers, "list-unsubscribe")) return true;

  // Пустой конверт: «<>» или совсем пусто при наличии самого заголовка
  const returnPath = headerText(headers, "return-path");
  if (returnPath === "<>" || returnPath === "<") return true;
  if (headers.has?.("return-path") && returnPath === "") return true;

  return false;
};

module.exports = { isMachineMail };
