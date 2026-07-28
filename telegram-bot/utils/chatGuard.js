const logger = require("./logger");
const { isProduction } = require("./mailGuard");

/**
 * Заглушка телеграма вне прода — та же дверь, что и у почты.
 *
 * Дев работает на копии прод-базы, и `telegramBot.chatId` в ней — настоящие
 * идентификаторы клиентов. В Telegram chat.id личного чата равен id
 * ПОЛЬЗОВАТЕЛЯ и одинаков для всех ботов: если человек когда-нибудь запускал
 * тестового бота, дев-уведомление дойдёт до него по-настоящему. Изоляция «у
 * дева другой бот» держится только на том, что клиент тестового бота не
 * запускал, — на это нельзя опираться.
 *
 * Стоит на ПОТРЕБИТЕЛЕ ОЧЕРЕДИ, а не на отправке сообщений вообще: интерактив
 * самого бота (ответы тому, кто прямо сейчас пишет деву) идёт мимо очереди и
 * ломаться не должен.
 *
 * Условие «от обратного», как у почты: блокируем всегда, КРОМЕ явного
 * NODE_ENV=production. Без `DEV_TELEGRAM_CHAT_ID` уведомление не уходит вовсе —
 * молчание безопаснее письма чужому человеку.
 *
 * Зеркало для почты — utils/mailGuard.js.
 */

const DEV_CHAT_ID = process.env.DEV_TELEGRAM_CHAT_ID || null;

const guardChat = (chatId) => {
  if (isProduction() || !chatId) {
    return { chatId, redirected: false, blocked: false, intended: chatId };
  }
  if (String(chatId) === String(DEV_CHAT_ID)) {
    return { chatId, redirected: false, blocked: false, intended: chatId };
  }
  if (!DEV_CHAT_ID) {
    logger.log("warn", "Telegram notification blocked (non-production)", {
      module: "chatGuard",
      intended: String(chatId),
    });
    return { chatId: null, redirected: false, blocked: true, intended: chatId };
  }
  logger.log("warn", "Telegram recipient redirected (non-production)", {
    module: "chatGuard",
    intended: String(chatId),
    actual: String(DEV_CHAT_ID),
  });
  return {
    chatId: DEV_CHAT_ID,
    redirected: true,
    blocked: false,
    intended: chatId,
  };
};

/** Куда сообщение шло на самом деле — иначе в деве не понять, кому писали. */
const guardText = (text, intended) =>
  isProduction() ? text : `[DEV → chatId ${intended}]\n\n${text || ""}`;

logger.log(
  isProduction() ? "info" : "warn",
  isProduction()
    ? "Chat guard OFF (production): уведомления уходят настоящим получателям"
    : DEV_CHAT_ID
      ? `Chat guard ON: ВСЕ telegram-уведомления уходят только в чат ${DEV_CHAT_ID}`
      : "Chat guard ON: telegram-уведомления не отправляются (DEV_TELEGRAM_CHAT_ID не задан)",
  { module: "chatGuard", nodeEnv: process.env.NODE_ENV || null },
);

module.exports = { DEV_CHAT_ID, guardChat, guardText };
