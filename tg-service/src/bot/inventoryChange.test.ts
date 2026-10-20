// node --test src/bot/inventoryChange.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { handleInventoryChange, type InventoryChangeDeps } from "./inventoryChange.ts";

const ID = "64f100000000000000000001";
const KB = { inline_keyboard: [[{ text: "Утвердить", callback_data: `ic:a:${ID}` }]] };
const CONFIRM_KB = { inline_keyboard: [[{ text: "Да, применить", callback_data: `ic:y:${ID}` }]] };

const fakeCtx = (type = "private") => {
  const log = { answers: [] as unknown[], edits: [] as unknown[], markups: [] as unknown[], replies: [] as unknown[] };
  const ctx = {
    chat: { type },
    answerCallbackQuery: async (o?: unknown) => { log.answers.push(o ?? null); return true; },
    editMessageText: async (text: string, other?: unknown) => { log.edits.push({ text, other }); return true; },
    editMessageReplyMarkup: async (o?: unknown) => { log.markups.push(o); return true; },
    reply: async (text: string) => { log.replies.push(text); return true; },
  };
  return { ctx: ctx as never, log };
};

const deps = (over: Partial<InventoryChangeDeps> = {}) => {
  const calls: unknown[][] = [];
  const d: InventoryChangeDeps = {
    fetchMessage: async (...a) => {
      calls.push(["fetch", ...a]);
      return { ok: true, text: "Пакет «Новые ноутбуки»", keyboard: KB as never, confirmText: "Применить?\n\nОперации (1):\n1. x", confirmKeyboard: CONFIRM_KB as never };
    },
    decide: async (...a) => { calls.push(["decide", ...a]); return { ok: true, text: "Вы отклонили пакет «Новые ноутбуки»." }; },
    explain: () => "Что-то пошло не так, попробуйте позже",
    isUncertain: (e) => (e as { uncertain?: boolean }).uncertain === true,
    warn: (message, meta) => { calls.push(["warn", message, meta]); },
    ...over,
  };
  return { d, calls };
};

test("чужие и кривые данные игнорируются одним пустым ответом", async () => {
  for (const data of ["ic:a:123", "ic:z:" + ID, `ic:a:${ID.toUpperCase()}`, `ic:a:${ID}0`, "ic:"]) {
    const { ctx, log } = fakeCtx();
    const { d, calls } = deps();
    await handleInventoryChange(ctx, 1, data, d);
    assert.deepEqual(log.answers, [null], data);
    assert.equal(calls.length, 0);
    assert.equal(log.edits.length, 0);
  }
});

test("не личный чат: один алерт, бэкенд не вызывается", async () => {
  const { ctx, log } = fakeCtx("supergroup");
  const { d, calls } = deps();
  await handleInventoryChange(ctx, 1, `ic:y:${ID}`, d);
  assert.deepEqual(log.answers, [{ text: "Решение принимается в личном чате с ботом", show_alert: true }]);
  assert.equal(calls.length, 0);
});

test("ic:a — сообщение заменяется шагом подтверждения с командами", async () => {
  const { ctx, log } = fakeCtx();
  const { d, calls } = deps();
  await handleInventoryChange(ctx, 5, `ic:a:${ID}`, d);
  assert.deepEqual(calls, [["fetch", 5, ID]]);
  assert.deepEqual(log.answers, [null]);
  assert.deepEqual(log.edits, [{ text: "Применить?\n\nОперации (1):\n1. x", other: { reply_markup: CONFIRM_KB } }]);
});

test("ic:a — пакет не помещается: алерт, решения не предлагаются", async () => {
  const { ctx, log } = fakeCtx();
  const { d } = deps({ fetchMessage: async () => ({ ok: true, text: "Запрос", keyboard: null, confirmText: null, confirmKeyboard: null }) });
  await handleInventoryChange(ctx, 5, `ic:a:${ID}`, d);
  assert.deepEqual(log.answers, [{ text: "Пакет большой — утвердить можно в портале", show_alert: true }]);
  assert.deepEqual(log.edits, [{ text: "Запрос", other: {} }]);
});

test("ic:b — возвращает исходный текст и кнопки", async () => {
  const { ctx, log } = fakeCtx();
  await handleInventoryChange(ctx, 5, `ic:b:${ID}`, deps().d);
  assert.deepEqual(log.answers, [null]);
  assert.deepEqual(log.edits, [{ text: "Пакет «Новые ноутбуки»", other: { reply_markup: KB } }]);
});

test("ic:y и ic:r — решение уходит бэкенду от имени нажавшего, сообщение без кнопок", async () => {
  for (const [letter, decision] of [["y", "approve"], ["r", "reject"]] as const) {
    const { ctx, log } = fakeCtx();
    const { d, calls } = deps();
    await handleInventoryChange(ctx, 42, `ic:${letter}:${ID}`, d);
    assert.deepEqual(calls, [["decide", 42, ID, decision]]);
    assert.deepEqual(log.answers, [{ text: "Решение записано" }]);
    assert.deepEqual(log.edits, [{ text: "Вы отклонили пакет «Новые ноутбуки».", other: undefined }]);
  }
});

test("отказ: алерт с текстом; устаревшие коды заменяют текст сообщения и убирают кнопки", async () => {
  for (const [code, stale] of [["closed", true], ["expired", true], ["not_found", true], ["not_yours", true], ["no_right", true]] as const) {
    const { ctx, log } = fakeCtx();
    const { d } = deps({ decide: async () => ({ ok: false, code, message: `отказ ${code}` }) });
    await handleInventoryChange(ctx, 1, `ic:y:${ID}`, d);
    assert.deepEqual(log.answers, [{ text: `отказ ${code}`, show_alert: true }]);
    // editMessageText без reply_markup убирает и кнопки
    assert.deepEqual(log.edits, stale ? [{ text: `отказ ${code}`, other: undefined }] : [], code);
  }
  const { ctx, log } = fakeCtx();
  const { d } = deps({ fetchMessage: async () => ({ ok: false, code: "closed", message: "Решение уже принято" }) });
  await handleInventoryChange(ctx, 1, `ic:a:${ID}`, d);
  assert.deepEqual(log.answers, [{ text: "Решение уже принято", show_alert: true }]);
  assert.deepEqual(log.edits, [{ text: "Решение уже принято", other: undefined }]);
});

test("too_long на ic:y: алерт, затем вид без кнопок решения из /message", async () => {
  const { ctx, log } = fakeCtx();
  const linkOnly = { inline_keyboard: [[{ text: "Открыть в портале", url: "https://x" }]] };
  const { d } = deps({
    decide: async () => ({ ok: false, code: "too_long", message: "Пакет не помещается в сообщение — утвердите его в портале" }),
    fetchMessage: async () => ({ ok: true, text: "Пакет «Новые ноутбуки»", keyboard: linkOnly as never, confirmText: null, confirmKeyboard: null }),
  });
  await handleInventoryChange(ctx, 1, `ic:y:${ID}`, d);
  assert.deepEqual(log.answers, [{ text: "Пакет не помещается в сообщение — утвердите его в портале", show_alert: true }]);
  assert.deepEqual(log.edits, [{ text: "Пакет «Новые ноутбуки»", other: { reply_markup: linkOnly } }]);
});

test("успех: правка не прошла — ошибка в журнал (без текста), результат новым сообщением", async () => {
  const { ctx, log } = fakeCtx();
  (ctx as { editMessageText: unknown }).editMessageText = async () => { throw new Error("Bad Request: message can't be edited"); };
  const { d, calls } = deps();
  await handleInventoryChange(ctx, 1, `ic:r:${ID}`, d);
  assert.deepEqual(log.replies, ["Вы отклонили пакет «Новые ноутбуки»."]);
  const warned = calls.find((c) => c[0] === "warn") as unknown[];
  assert.ok(warned);
  assert.ok(!JSON.stringify(warned).includes("Вы отклонили"));
  assert.ok(JSON.stringify(warned).includes(ID));
});

test("успех: «not modified» — без нового сообщения", async () => {
  const { ctx, log } = fakeCtx();
  (ctx as { editMessageText: unknown }).editMessageText = async () => { throw new Error("Bad Request: message is not modified"); };
  await handleInventoryChange(ctx, 1, `ic:r:${ID}`, deps().d);
  assert.deepEqual(log.replies, []);
});

test("сеть или таймаут при решении: подсказка нажать ещё раз, кнопки остаются", async () => {
  for (const letter of ["y", "r"]) {
    const { ctx, log } = fakeCtx();
    const { d } = deps({ decide: async () => { throw Object.assign(new Error("timeout"), { uncertain: true }); } });
    await handleInventoryChange(ctx, 1, `ic:${letter}:${ID}`, d);
    assert.deepEqual(log.answers, [{ text: "Не удалось получить ответ сервера. Нажмите ещё раз — если решение уже записано, бот покажет это.", show_alert: true }]);
    assert.equal(log.edits.length + log.markups.length, 0);
  }
});

test("429 лимитера: бот показывает message ответа", async () => {
  const { ctx, log } = fakeCtx();
  const { d } = deps({
    decide: async () => { throw Object.assign(new Error("Слишком много нажатий. Подождите минуту."), { status: 429 }); },
    explain: (e) => (e as Error).message,
  });
  await handleInventoryChange(ctx, 1, `ic:y:${ID}`, d);
  assert.deepEqual(log.answers, [{ text: "Слишком много нажатий. Подождите минуту.", show_alert: true }]);
});

test("сбой бэкенда или сети: один алерт с текстом explain, сообщение не тронуто", async () => {
  for (const letter of ["a", "b", "y", "r"]) {
    const { ctx, log } = fakeCtx();
    const boom = async () => { throw new Error("down"); };
    await handleInventoryChange(ctx, 1, `ic:${letter}:${ID}`, deps({ fetchMessage: boom, decide: boom }).d);
    assert.deepEqual(log.answers, [{ text: "Что-то пошло не так, попробуйте позже", show_alert: true }], letter);
    assert.equal(log.edits.length + log.markups.length, 0);
  }
});

test("«message is not modified» при правке — не ошибка и не второй ответ", async () => {
  const { ctx, log } = fakeCtx();
  (ctx as { editMessageText: unknown }).editMessageText = async () => { throw new Error("message is not modified"); };
  await handleInventoryChange(ctx, 1, `ic:b:${ID}`, deps().d);
  assert.deepEqual(log.answers, [null]);
});

test("ни правки, ни ответы в ic: не используют parse_mode", async () => {
  for (const letter of ["a", "b", "y", "r"]) {
    const { ctx, log } = fakeCtx();
    await handleInventoryChange(ctx, 1, `ic:${letter}:${ID}`, deps().d);
    const refusal = fakeCtx();
    await handleInventoryChange(refusal.ctx, 1, `ic:${letter}:${ID}`, deps({
      fetchMessage: async () => ({ ok: false, code: "closed", message: "x" }),
      decide: async () => ({ ok: false, code: "closed", message: "x" }),
    }).d);
    for (const l of [log, refusal.log]) {
      assert.ok(!JSON.stringify([l.answers, l.edits, l.markups]).includes("parse_mode"), letter);
    }
  }
});
