import { Bot, GrammyError, HttpError } from "grammy";

import { ackOutbox, pullOutbox } from "../api/backend.ts";
import { tryApi } from "../api/client.ts";
import type { DeliveryOutcome, OutboxItem } from "../api/types.ts";
import { logger } from "../logger.ts";
import { recordDelivery, wasDelivered } from "../store/deliveries.ts";

/**
 * Доставка уведомлений.
 *
 * Порядок один и менять его нельзя: СВЕРИТЬСЯ с локальной таблицей → отправить
 * → ЗАПИСАТЬ туда же → подтвердить бэкенду. Умри сервис между отправкой и
 * подтверждением — аренда протухнет, очередь предложит уведомление снова, и
 * запись не даст отправить его человеку дважды.
 *
 * Прежний отправщик вместо всего этого держал `sleep(2000)` — цикл `while` на
 * `Date.now()`, то есть две секунды сжигания процессора на каждое уведомление,
 * блокирующие весь процесс, включая ответы тем, кто прямо сейчас пишет боту.
 */

/**
 * Пауза между отправками. У Telegram потолок около 30 сообщений в секунду;
 * 60 мс дают запас и не превращают рассылку в очередь на минуты. Это `await`,
 * а не занятое ожидание: процесс в это время обслуживает команды.
 */
const SEND_GAP_MS = 60;

/** Дольше этого не ждём даже по просьбе Telegram: аренду пора отпускать. */
const MAX_RETRY_AFTER_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ошибка Telegram, после которой повторять бессмысленно: бот заблокирован, чат
 * удалён, бота выкинули из группы. Такое уведомление надо закрывать сразу, а не
 * перебирать до предела попыток, как делал прежний бот.
 */
const isPermanent = (error: GrammyError): boolean => {
  const description = error.description.toLowerCase();
  return (
    error.error_code === 403 ||
    description.includes("chat not found") ||
    description.includes("user is deactivated") ||
    description.includes("bot was kicked") ||
    description.includes("group chat was upgraded")
  );
};

/**
 * Отправка: сначала рич-сообщением, при отказе — обычным.
 *
 * Рич-формату два месяца (Bot API 10.1), и как он ведёт себя на всех клиентах,
 * проверено не до конца. Поэтому у каждого уведомления есть вторая форма —
 * та же мысль обычной HTML-разметкой, — и отказ API по форме сообщения не
 * должен стоить доставки. Откат делается ОДИН раз и только на понятной ошибке
 * формата: сеть и лимиты разбираются выше, повторной попыткой.
 *
 * 429 наверх пробрасывается как есть: пауза касается всей пачки.
 */
const sendEither = async (
  bot: Bot,
  item: OutboxItem,
  common: Record<string, unknown>,
) => {
  if (item.richMessage?.length) {
    try {
      return await bot.api.sendRichMessage(
        item.chatId,
        { blocks: item.richMessage },
        common,
      );
    } catch (error) {
      if (error instanceof GrammyError && error.error_code !== 429) {
        logger.warn("Rich message rejected, falling back to plain HTML", {
          id: item.id,
          description: error.description,
        });
      } else {
        throw error;
      }
    }
  }

  return bot.api.sendMessage(item.chatId, item.text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...common,
  });
};

/**
 * Telegram отказался от КНОПКИ, а не от сообщения.
 *
 * Ссылка на localhost — `BUTTON_URL_INVALID`, и отказ приходит на всё
 * сообщение целиком. Бэкенд кнопку ставит всегда (это правило продукта:
 * ссылка на заявку в каждом уведомлении), а годность адреса знает только тот,
 * кто получил ответ Telegram. Поэтому решение здесь: повторить без разметки.
 * Уведомление важнее кнопки.
 */
const isBadButton = (error: unknown): boolean =>
  error instanceof GrammyError &&
  error.description.toUpperCase().includes("BUTTON_URL_INVALID");

const deliver = async (bot: Bot, item: OutboxItem): Promise<DeliveryOutcome> => {
  // 1. Не отправляли ли уже? Это и есть защита от повторной доставки.
  const already = wasDelivered(item.id);
  if (already) {
    logger.info("Notification already delivered, re-acknowledging", {
      id: item.id,
    });
    return { id: item.id, ok: true, tgMessageId: already.tgMessageId ?? 0 };
  }

  const common = {
    ...(item.replyMarkup ? { reply_markup: item.replyMarkup } : {}),
    ...(item.messageThreadId
      ? { message_thread_id: Number(item.messageThreadId) }
      : {}),
  };

  try {
    let message;
    try {
      message = await sendEither(bot, item, common);
    } catch (error) {
      if (!isBadButton(error)) throw error;
      const { reply_markup: _dropped, ...withoutButton } = common;
      logger.warn("Telegram refused the button, resending without it", {
        id: item.id,
        hint: "ADDRESS должен быть публичным http(s)-адресом",
      });
      message = await sendEither(bot, item, withoutButton);
    }

    // 2. Записываем ДО подтверждения: подтверждение может не доехать.
    recordDelivery(item.id, message.message_id);
    return { id: item.id, ok: true, tgMessageId: message.message_id };
  } catch (error) {
    if (error instanceof GrammyError) {
      // 429 разбирает ВЫЗЫВАЮЩИЙ: решение касается всей пачки, а не одного
      // уведомления — надо перестать слать и выждать столько, сколько просят.
      if (error.error_code === 429) {
        throw error;
      }
      if (isPermanent(error)) {
        logger.warn("Notification undeliverable, closing", {
          id: item.id,
          description: error.description,
        });
        return {
          id: item.id,
          ok: false,
          retryable: false,
          reason: error.description,
        };
      }
      return {
        id: item.id,
        ok: false,
        retryable: true,
        reason: error.description,
      };
    }

    if (error instanceof HttpError) {
      return { id: item.id, ok: false, retryable: true, reason: "Telegram network failure" };
    }

    logger.error("Unexpected send failure", error);
    return {
      id: item.id,
      ok: false,
      retryable: true,
      reason: error instanceof Error ? error.message : "unknown error",
    };
  }
};

/** Просьба Telegram подождать. Прежний отправщик её игнорировал. */
const retryAfterMs = (error: unknown): number | null => {
  if (error instanceof GrammyError && error.error_code === 429) {
    const seconds = error.parameters?.retry_after;
    return seconds ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : 1000;
  }
  return null;
};

export const runOutboxCycle = async (bot: Bot): Promise<void> => {
  const batch = await tryApi("pull the notification queue", () => pullOutbox());
  if (!batch || batch.notifications.length === 0) {
    return;
  }

  logger.debug("Claimed a batch of notifications", {
    leaseId: batch.leaseId,
    count: batch.notifications.length,
  });

  const results: DeliveryOutcome[] = [];
  let throttledFor: number | null = null;

  for (const item of batch.notifications) {
    if (throttledFor !== null) {
      /**
       * Telegram попросил притормозить. Остаток пачки не трогаем и отдаём
       * повторяемым: аренда освободится подтверждением, и очередь предложит их
       * заново — это честнее, чем держать аренду и молотить в закрытую дверь.
       */
      results.push({
        id: item.id,
        ok: false,
        retryable: true,
        reason: "Telegram asked us to slow down",
      });
      continue;
    }

    try {
      results.push(await deliver(bot, item));
    } catch (error) {
      const wait = retryAfterMs(error);
      if (wait !== null) {
        throttledFor = wait;
        results.push({
          id: item.id,
          ok: false,
          retryable: true,
          reason: "Telegram asked us to slow down",
        });
        continue;
      }
      throw error;
    }

    await sleep(SEND_GAP_MS);
  }

  await tryApi("acknowledge delivery", () => ackOutbox(batch.leaseId, results));

  if (throttledFor !== null) {
    logger.warn("Telegram rate-limited us, waiting", { ms: throttledFor });
    await sleep(throttledFor);
  }
};
