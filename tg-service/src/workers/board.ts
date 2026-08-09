import { createHash } from "node:crypto";
import { Bot, GrammyError } from "grammy";

import { fetchBoard, reportBoardMessage } from "../api/backend.ts";
import { tryApi } from "../api/client.ts";
import type { BotConfig } from "../api/types.ts";
import { renderBoard, boardKeyboard } from "../bot/render.ts";
import { logger } from "../logger.ts";
import { forgetBoard, getRenderedHash, setRenderedHash } from "../store/board.ts";

/**
 * Табло присутствия: одно закреплённое сообщение в группе команды, которое
 * правится по кругу.
 *
 * Состав людей берётся с бэкенда тем же контроллером, что рисует бар в
 * интерфейсе. Копия этого запроса в прежнем боте фильтровала по `isActive`,
 * которого после переезда на `banned` в документах нет вовсе, — то есть табло
 * совпадало с пустым списком и никто этого не замечал, потому что молча пустой
 * список выглядит как «никто не отметился».
 *
 * `messageId` живёт на бэкенде (`preferences.statusBoard`), локально хранится
 * только хеш отрисованного — чтобы не звать `editMessageText` впустую.
 */

const hashOf = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** Группу повысили до супергруппы — у чата новый идентификатор. */
const migratedChatId = (error: GrammyError): string | null => {
  const to = error.parameters?.migrate_to_chat_id;
  return to ? String(to) : null;
};

const isMissingMessage = (error: GrammyError): boolean => {
  const description = error.description.toLowerCase();
  return (
    description.includes("message to edit not found") ||
    description.includes("message can't be edited") ||
    description.includes("message thread not found")
  );
};

export const runBoardCycle = async (bot: Bot, config: BotConfig): Promise<void> => {
  const chatId = config.telegram.chatId;

  if (!config.statusBoard.isActive || !chatId) {
    return;
  }

  const board = await tryApi("получить состав табло", () => fetchBoard());
  if (!board) return;

  const text = renderBoard(board.users, config);
  const hash = hashOf(text);
  const threadId = config.telegram.messageThreadId
    ? Number(config.telegram.messageThreadId)
    : undefined;

  // Сообщения ещё нет — создаём и закрепляем.
  if (config.statusBoard.messageId === null) {
    try {
      const message = await bot.api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: boardKeyboard(config.workStatuses),
        ...(threadId ? { message_thread_id: threadId } : {}),
      });

      await bot.api
        .pinChatMessage(chatId, message.message_id, {
          disable_notification: true,
        })
        .catch((error: unknown) => {
          // Права на закрепление может не быть — табло от этого работать не
          // перестаёт, а падать из-за украшения незачем.
          logger.warn("Не удалось закрепить табло", error);
        });

      setRenderedHash(chatId, hash);
      await tryApi("сообщить id табло", () =>
        reportBoardMessage({ messageId: message.message_id }),
      );
      logger.info("Табло создано", { chatId, messageId: message.message_id });
    } catch (error) {
      logger.warn("Не удалось создать табло", error);
    }
    return;
  }

  // Текст не изменился — Telegram на такую правку отвечает ошибкой, и звать её
  // незачем. Ради этого сравнения и живёт локальный хеш.
  if (getRenderedHash(chatId) === hash) {
    return;
  }

  try {
    await bot.api.editMessageText(chatId, config.statusBoard.messageId, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      // Клавиатуру передаём на КАЖДОЙ правке: без неё Telegram снимает кнопки.
      reply_markup: boardKeyboard(config.workStatuses),
    });
    setRenderedHash(chatId, hash);
  } catch (error) {
    if (!(error instanceof GrammyError)) {
      logger.warn("Не удалось обновить табло", error);
      return;
    }

    // «Ничего не изменилось» — не ошибка: значит наш хеш разошёлся с
    // действительностью, и его надо просто принять.
    if (error.description.toLowerCase().includes("message is not modified")) {
      setRenderedHash(chatId, hash);
      return;
    }

    const migrated = migratedChatId(error);
    if (migrated) {
      logger.warn("Группа стала супергруппой, адрес табло изменился", {
        from: chatId,
        to: migrated,
      });
      forgetBoard(chatId);
      // Бэкенду это важнее, чем нам: он адресует по этому же chatId групповые
      // уведомления, и без правки они уходили бы в несуществующий чат.
      await tryApi("сообщить о переезде чата", () =>
        reportBoardMessage({ migratedToChatId: migrated }),
      );
      return;
    }

    if (isMissingMessage(error)) {
      logger.warn("Сообщение табло исчезло, будет создано заново");
      forgetBoard(chatId);
      await tryApi("сбросить id табло", () =>
        reportBoardMessage({ messageId: null }),
      );
      return;
    }

    logger.warn("Не удалось обновить табло", error);
  }
};
