// node --test src/bot/mikrotikChange.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { handleMikrotikChange, type MikrotikChangeDeps } from "./mikrotikChange.ts";

const ID = "64f100000000000000000001";
const KB = { inline_keyboard: [[{ text: "Утвердить", callback_data: `mc:a:${ID}` }]] };
const CONFIRM_KB = { inline_keyboard: [[{ text: "Да, применить", callback_data: `mc:y:${ID}` }]] };

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

const deps = (over: Partial<MikrotikChangeDeps> = {}) => {
  const calls: unknown[][] = [];
  const d: MikrotikChangeDeps = {
    fetchMessage: async (...a) => {
      calls.push(["fetch", ...a]);
      return { ok: true, text: "Запрос № 7", keyboard: KB as never, confirmText: "Применить?", confirmFull: "Применить?\n\nКоманды (1):\n1. x", confirmKeyboard: CONFIRM_KB as never };
    },
    decide: async (...a) => { calls.push(["decide", ...a]); return { ok: true, text: "Вы отклонили запрос № 7." }; },
    explain: () => "Что-то пошло не так, попробуйте позже",
    isUncertain: (e) => (e as { uncertain?: boolean }).uncertain === true,
    warn: (message, meta) => { calls.push(["warn", message, meta]); },
    ...over,
  };
  return { d, calls };
};

test("чужие и кривые данные игнорируются одним пустым ответом", async () => {
  for (const data of ["mc:a:123", "mc:z:" + ID, `mc:a:${ID.toUpperCase()}`, `mc:a:${ID}0`, "mc:"]) {
    const { ctx, log } = fakeCtx();
    const { d, calls } = deps();
    await handleMikrotikChange(ctx, 1, data, d);
    assert.deepEqual(log.answers, [null], data);
    assert.equal(calls.length, 0);
    assert.equal(log.edits.length, 0);
  }
});

test("не личный чат: один алерт, бэкенд не вызывается", async () => {
  const { ctx, log } = fakeCtx("supergroup");
  const { d, calls } = deps();
  await handleMikrotikChange(ctx, 1, `mc:y:${ID}`, d);
  assert.deepEqual(log.answers, [{ text: "Решение принимается в личном чате с ботом", show_alert: true }]);
  assert.equal(calls.length, 0);
});

test("mc:a — сообщение заменяется шагом подтверждения с командами", async () => {
  const { ctx, log } = fakeCtx();
  const { d, calls } = deps();
  await handleMikrotikChange(ctx, 5, `mc:a:${ID}`, d);
  assert.deepEqual(calls, [["fetch", 5, ID]]);
  assert.deepEqual(log.answers, [null]);
  assert.deepEqual(log.edits, [{ text: "Применить?\n\nКоманды (1):\n1. x", other: { reply_markup: CONFIRM_KB } }]);
});

test("mc:a — не помещается: алерт, решения не предлагаются", async () => {
  const { ctx, log } = fakeCtx();
  const { d } = deps({ fetchMessage: async () => ({ ok: true, text: "Запрос", keyboard: null, confirmText: null, confirmFull: null, confirmKeyboard: null }) });
  await handleMikrotikChange(ctx, 5, `mc:a:${ID}`, d);
  assert.deepEqual(log.answers, [{ text: "Команды не помещаются в сообщение — откройте запрос в HD", show_alert: true }]);
  assert.deepEqual(log.edits, [{ text: "Запрос", other: {} }]);
});

test("mc:b — возвращает исходный текст и кнопки", async () => {
  const { ctx, log } = fakeCtx();
  await handleMikrotikChange(ctx, 5, `mc:b:${ID}`, deps().d);
  assert.deepEqual(log.answers, [null]);
  assert.deepEqual(log.edits, [{ text: "Запрос № 7", other: { reply_markup: KB } }]);
});

test("mc:y и mc:r — решение уходит бэкенду от имени нажавшего, сообщение без кнопок", async () => {
  for (const [letter, decision] of [["y", "approve"], ["r", "reject"]] as const) {
    const { ctx, log } = fakeCtx();
    const { d, calls } = deps();
    await handleMikrotikChange(ctx, 42, `mc:${letter}:${ID}`, d);
    assert.deepEqual(calls, [["decide", 42, ID, decision]]);
    assert.deepEqual(log.answers, [{ text: "Решение записано" }]);
    assert.deepEqual(log.edits, [{ text: "Вы отклонили запрос № 7.", other: undefined }]);
  }
});

test("отказ: алерт с текстом; устаревшие коды заменяют текст сообщения и убирают кнопки", async () => {
  for (const [code, stale] of [["closed", true], ["expired", true], ["already_yours", true], ["not_found", true], ["not_yours", false], ["no_right", false]] as const) {
    const { ctx, log } = fakeCtx();
    const { d } = deps({ decide: async () => ({ ok: false, code, message: `отказ ${code}` }) });
    await handleMikrotikChange(ctx, 1, `mc:y:${ID}`, d);
    assert.deepEqual(log.answers, [{ text: `отказ ${code}`, show_alert: true }]);
    // editMessageText без reply_markup убирает и кнопки
    assert.deepEqual(log.edits, stale ? [{ text: `отказ ${code}`, other: undefined }] : [], code);
  }
  const { ctx, log } = fakeCtx();
  const { d } = deps({ fetchMessage: async () => ({ ok: false, code: "already_yours", message: "Вы уже подтвердили запрос № 7. Дальше решает Анна." }) });
  await handleMikrotikChange(ctx, 1, `mc:a:${ID}`, d);
  assert.deepEqual(log.answers, [{ text: "Вы уже подтвердили запрос № 7. Дальше решает Анна.", show_alert: true }]);
  assert.deepEqual(log.edits, [{ text: "Вы уже подтвердили запрос № 7. Дальше решает Анна.", other: undefined }]);
});

test("too_long на mc:y: алерт, затем вид без кнопок решения из /message", async () => {
  const { ctx, log } = fakeCtx();
  const linkOnly = { inline_keyboard: [[{ text: "Открыть в HD", url: "https://x" }]] };
  const { d } = deps({
    decide: async () => ({ ok: false, code: "too_long", message: "Команды не помещаются в сообщение — утвердите запрос в HD" }),
    fetchMessage: async () => ({ ok: true, text: "Запрос № 7", keyboard: linkOnly as never, confirmText: null, confirmFull: null, confirmKeyboard: null }),
  });
  await handleMikrotikChange(ctx, 1, `mc:y:${ID}`, d);
  assert.deepEqual(log.answers, [{ text: "Команды не помещаются в сообщение — утвердите запрос в HD", show_alert: true }]);
  assert.deepEqual(log.edits, [{ text: "Запрос № 7", other: { reply_markup: linkOnly } }]);
});

test("успех: правка не прошла — ошибка в журнал (без текста), результат новым сообщением", async () => {
  const { ctx, log } = fakeCtx();
  (ctx as { editMessageText: unknown }).editMessageText = async () => { throw new Error("Bad Request: message can't be edited"); };
  const { d, calls } = deps();
  await handleMikrotikChange(ctx, 1, `mc:r:${ID}`, d);
  assert.deepEqual(log.replies, ["Вы отклонили запрос № 7."]);
  const warned = calls.find((c) => c[0] === "warn") as unknown[];
  assert.ok(warned);
  assert.ok(!JSON.stringify(warned).includes("Вы отклонили"));
  assert.ok(JSON.stringify(warned).includes(ID));
});

test("успех: «not modified» — без нового сообщения", async () => {
  const { ctx, log } = fakeCtx();
  (ctx as { editMessageText: unknown }).editMessageText = async () => { throw new Error("Bad Request: message is not modified"); };
  await handleMikrotikChange(ctx, 1, `mc:r:${ID}`, deps().d);
  assert.deepEqual(log.replies, []);
});

test("сеть или таймаут при решении: подсказка нажать ещё раз, кнопки остаются", async () => {
  for (const letter of ["y", "r"]) {
    const { ctx, log } = fakeCtx();
    const { d } = deps({ decide: async () => { throw Object.assign(new Error("timeout"), { uncertain: true }); } });
    await handleMikrotikChange(ctx, 1, `mc:${letter}:${ID}`, d);
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
  await handleMikrotikChange(ctx, 1, `mc:y:${ID}`, d);
  assert.deepEqual(log.answers, [{ text: "Слишком много нажатий. Подождите минуту.", show_alert: true }]);
});

test("сбой бэкенда или сети: один алерт с текстом explain, сообщение не тронуто", async () => {
  for (const letter of ["a", "b", "y", "r"]) {
    const { ctx, log } = fakeCtx();
    const boom = async () => { throw new Error("down"); };
    await handleMikrotikChange(ctx, 1, `mc:${letter}:${ID}`, deps({ fetchMessage: boom, decide: boom }).d);
    assert.deepEqual(log.answers, [{ text: "Что-то пошло не так, попробуйте позже", show_alert: true }], letter);
    assert.equal(log.edits.length + log.markups.length, 0);
  }
});

test("«message is not modified» при правке — не ошибка и не второй ответ", async () => {
  const { ctx, log } = fakeCtx();
  (ctx as { editMessageText: unknown }).editMessageText = async () => { throw new Error("message is not modified"); };
  await handleMikrotikChange(ctx, 1, `mc:b:${ID}`, deps().d);
  assert.deepEqual(log.answers, [null]);
});

test("ни правки, ни ответы в mc: не используют parse_mode", async () => {
  for (const letter of ["a", "b", "y", "r"]) {
    const { ctx, log } = fakeCtx();
    await handleMikrotikChange(ctx, 1, `mc:${letter}:${ID}`, deps().d);
    const refusal = fakeCtx();
    await handleMikrotikChange(refusal.ctx, 1, `mc:${letter}:${ID}`, deps({
      fetchMessage: async () => ({ ok: false, code: "closed", message: "x" }),
      decide: async () => ({ ok: false, code: "closed", message: "x" }),
    }).d);
    for (const l of [log, refusal.log]) {
      assert.ok(!JSON.stringify([l.answers, l.edits, l.markups]).includes("parse_mode"), letter);
    }
  }
});
