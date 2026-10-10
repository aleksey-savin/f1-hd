import type { Context } from "grammy";

import type { MikrotikChangeDecisionResult, MikrotikChangeView } from "../api/types.ts";

/**
 * Кнопки решения по запросу ИИ-агента на изменение Mikrotik (`mc:*`).
 *
 * Нажатие может отправить команды на боевой роутер клиента, поэтому тут три
 * правила. Кто нажал, знает только бэкенд (по `actor`), а не текст кнопки.
 * «Один раз» обеспечивает атомарная запись на бэкенде: повторное нажатие даёт
 * `closed`. Утверждать можно лишь то, что показано целиком: шаг подтверждения
 * берёт текст у бэкенда и не строится из того, что бот помнит.
 *
 * Зависимости приходят аргументами, чтобы модуль проверялся без сети и без
 * настоящего Telegram.
 */

type Callback = Pick<
  Context,
  "chat" | "answerCallbackQuery" | "editMessageText" | "editMessageReplyMarkup" | "reply"
>;

export type MikrotikChangeDeps = {
  fetchMessage: (actor: number, id: string) => Promise<MikrotikChangeView>;
  decide: (
    actor: number,
    id: string,
    decision: "approve" | "reject",
  ) => Promise<MikrotikChangeDecisionResult>;
  /** Текст ошибки бэкенда или сети для человека. */
  explain: (error: unknown) => string;
  /** Ответ на решение мог не дойти (сеть, таймаут, 5xx): решение при этом могло быть записано. */
  isUncertain: (error: unknown) => boolean;
  /** В журнал, без текстов запроса. */
  warn: (message: string, meta: Record<string, unknown>) => void;
};

const DATA = /^mc:([abyr]):([0-9a-f]{24})$/;
const NOT_FITS = "Команды не помещаются в сообщение — откройте запрос в HD";
const UNCERTAIN =
  "Не удалось получить ответ сервера. Нажмите ещё раз — если решение уже записано, бот покажет это.";
/** Кнопки на сообщении устарели: сообщение заменяется причиной, чтобы вопрос «Применить?» не висел. */
const STALE = new Set(["closed", "expired", "already_yours", "not_found"]);

const isNotModified = (error: unknown) =>
  error instanceof Error && error.message.includes("message is not modified");

/** Заменить текст сообщения причиной; без reply_markup кнопки уходят. Не вышло — хотя бы убрать кнопки. */
const replaceWithReason = async (ctx: Callback, message: string) => {
  try {
    await ctx.editMessageText(message);
  } catch (error) {
    if (isNotModified(error)) return;
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  }
};

/**
 * Разобрать нажатие `mc:*`. Ровно один `answerCallbackQuery` на любом пути:
 * Telegram принимает только первый, и алерт с отказом нельзя терять.
 */
export const handleMikrotikChange = async (
  ctx: Callback,
  actor: number,
  data: string,
  deps: MikrotikChangeDeps,
): Promise<void> => {
  const alert = (text: string) =>
    ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => undefined);
  const ok = (text?: string) =>
    (text ? ctx.answerCallbackQuery({ text }) : ctx.answerCallbackQuery()).catch(() => undefined);

  const match = DATA.exec(data);
  if (!match) {
    await ok();
    return;
  }
  const [, action, id] = match as unknown as [string, string, string];

  // Кнопки могут остаться в переписке с кем угодно, но решение — только лично
  if (ctx.chat?.type !== "private") {
    await alert("Решение принимается в личном чате с ботом");
    return;
  }

  try {
    if (action === "y" || action === "r") {
      let result;
      try {
        result = await deps.decide(actor, id, action === "y" ? "approve" : "reject");
      } catch (error) {
        // Решение могло записаться, а ответ потеряться: кнопки остаются, повтор безопасен (бэкенд ответит, что уже решено)
        await alert(deps.isUncertain(error) ? UNCERTAIN : deps.explain(error));
        return;
      }
      if (!result.ok) {
        await alert(result.message);
        if (result.code === "too_long") {
          // Утверждать то, что не показано целиком, нельзя: возвращаем вид без кнопок решения
          const view = await deps.fetchMessage(actor, id).catch(() => null);
          if (view?.ok) {
            await ctx
              .editMessageText(view.text, view.keyboard ? { reply_markup: view.keyboard } : {})
              .catch(() => undefined);
          }
        } else if (result.code && STALE.has(result.code)) await replaceWithReason(ctx, result.message);
        return;
      }
      await ok("Решение записано");
      try {
        // Без reply_markup кнопки с сообщения уходят
        await ctx.editMessageText(result.text);
      } catch (error) {
        if (isNotModified(error)) return;
        deps.warn("Mikrotik change decision recorded, but the message edit failed", {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Человек должен узнать исход, даже если сообщение править нельзя
        await ctx.reply(result.text).catch(() => undefined);
      }
      return;
    }

    const view = await deps.fetchMessage(actor, id);
    if (!view.ok) {
      await alert(view.message);
      if (view.code && STALE.has(view.code)) await replaceWithReason(ctx, view.message);
      return;
    }

    if (action === "a") {
      if (!view.confirmFull || !view.confirmKeyboard) {
        await alert(NOT_FITS);
        // На сообщении остаются только ссылки: кнопок решения быть не должно
        await ctx
          .editMessageText(view.text, view.keyboard ? { reply_markup: view.keyboard } : {})
          .catch(() => undefined);
        return;
      }
      await ok();
      await ctx
        .editMessageText(view.confirmFull, { reply_markup: view.confirmKeyboard })
        .catch(() => undefined);
      return;
    }

    // action === "b": вернуть исходный вид
    await ok();
    await ctx
      .editMessageText(view.text, view.keyboard ? { reply_markup: view.keyboard } : {})
      .catch(() => undefined);
  } catch (error) {
    await alert(deps.explain(error));
  }
};
