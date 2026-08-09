import { config } from "../config.ts";
import { logger } from "../logger.ts";

/**
 * Предохранитель получателей вне прода.
 *
 * Перенесён из прежнего бота почти дословно — это единственное место, которое
 * там было сделано правильно, и рассуждение стоит повторить целиком.
 *
 * Дев работает на копии прод-базы, и `telegramBot.chatId` в ней — НАСТОЯЩИЕ
 * идентификаторы клиентов. В Telegram `chat.id` личного чата равен id
 * ПОЛЬЗОВАТЕЛЯ и одинаков для всех ботов: если человек когда-нибудь запускал
 * тестового бота, дев-уведомление дойдёт до него по-настоящему. Изоляция «у
 * дева другой бот» держится только на том, что клиент тестового бота не
 * запускал, — и опираться на это нельзя.
 *
 * Условие «от обратного»: блокируем всегда, КРОМЕ явного `NODE_ENV=production`.
 * Без `DEV_TELEGRAM_CHAT_ID` уведомление не уходит вовсе — молчание безопаснее
 * сообщения чужому человеку.
 *
 * Стоит на ОЧЕРЕДИ, а не на отправке вообще: ответы тому, кто прямо сейчас
 * пишет боту, идут мимо неё и ломаться не должны.
 */

export type GuardedTarget =
  | { blocked: true }
  | { blocked: false; chatId: string; redirected: boolean; intended: string };

export const guardChat = (chatId: string): GuardedTarget => {
  if (config.isProduction || !chatId) {
    return { blocked: false, chatId, redirected: false, intended: chatId };
  }

  if (config.devChatId && String(chatId) === String(config.devChatId)) {
    return { blocked: false, chatId, redirected: false, intended: chatId };
  }

  if (!config.devChatId) {
    logger.warn("Уведомление заблокировано (не прод)", {
      module: "chatGuard",
      intended: chatId,
    });
    return { blocked: true };
  }

  logger.warn("Получатель подменён (не прод)", {
    module: "chatGuard",
    intended: chatId,
    actual: config.devChatId,
  });
  return {
    blocked: false,
    chatId: config.devChatId,
    redirected: true,
    intended: chatId,
  };
};

/** Куда сообщение шло на самом деле — иначе в деве не понять, кому писали. */
export const guardText = (text: string, intended: string): string =>
  config.isProduction ? text : `[DEV → chatId ${intended}]\n\n${text}`;

export const announceGuard = (): void => {
  if (config.isProduction) {
    logger.info("Предохранитель ВЫКЛЮЧЕН (прод): уведомления идут настоящим получателям");
    return;
  }
  logger.warn(
    config.devChatId
      ? `Предохранитель ВКЛЮЧЁН: все уведомления уходят в чат ${config.devChatId}`
      : "Предохранитель ВКЛЮЧЁН: уведомления не отправляются (DEV_TELEGRAM_CHAT_ID не задан)",
  );
};
