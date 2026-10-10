const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyCtrlX, lostSafeMode, PROMPT, ENTER_UNTIL, RELEASE_UNTIL } = require("./safeModeConsole");

const HIJACK_TEXT = "Hijack safe mode of another user? [u/r/d]";

test("classifyCtrlX: вход, safe mode взят", () => {
  assert.equal(classifyCtrlX("\r\n[Safe Mode taken]\r\n[admin@R] <SAFE> ", { entering: true }), "taken");
  assert.equal(classifyCtrlX("[admin@R] <SAFE> ", { entering: true }), "taken");
  assert.equal(classifyCtrlX("[SAFE MODE TAKEN]", { entering: true }), "taken");
});

test("classifyCtrlX: выход, safe mode снят", () => {
  assert.equal(classifyCtrlX("\r\n[Safe Mode released]\r\n[admin@R] > ", { entering: false }), "released");
  assert.equal(classifyCtrlX("[safe mode released]", { entering: false }), "released");
});

test("classifyCtrlX: вопрос о перехвате побеждает taken", () => {
  assert.equal(classifyCtrlX(HIJACK_TEXT, { entering: true }), "busy");
  assert.equal(classifyCtrlX(`[Safe Mode taken]\r\n${HIJACK_TEXT}`, { entering: true }), "busy");
  assert.equal(classifyCtrlX("... [u/r/d]", { entering: false }), "busy");
  assert.equal(classifyCtrlX("hijack", { entering: false }), "busy");
});

test("classifyCtrlX: пустое и чужое — unknown", () => {
  assert.equal(classifyCtrlX("", { entering: true }), "unknown");
  assert.equal(classifyCtrlX("", { entering: false }), "unknown");
  assert.equal(classifyCtrlX("[admin@R] > ", { entering: true }), "unknown");
  // при входе released не подходит, при выходе taken не подходит
  assert.equal(classifyCtrlX("[Safe Mode released]", { entering: true }), "unknown");
  assert.equal(classifyCtrlX("[Safe Mode taken]", { entering: false }), "unknown");
});

test("lostSafeMode: свои остатки не считаются", () => {
  assert.equal(lostSafeMode(" [Safe Mode taken]\r\n[admin@R] <SAFE> "), false);
  assert.equal(lostSafeMode("]\r\n[admin@R] <SAFE> "), false);
  assert.equal(lostSafeMode(""), false);
});

test("lostSafeMode: чужое снятие, взятие и перехват", () => {
  assert.equal(lostSafeMode("[Safe mode released by another user]"), true);
  assert.equal(lostSafeMode("[Safe Mode released]"), true);
  assert.equal(lostSafeMode("[Safe mode unrolled by another user]"), true);
  assert.equal(lostSafeMode("[Safe Mode taken by another user]"), true);
  assert.equal(lostSafeMode(HIJACK_TEXT), true);
});

test("шаблоны ожидания и приглашение", () => {
  assert.ok(PROMPT.test("[admin@R] <SAFE> "));
  assert.ok(PROMPT.test("\r\n[admin@R] > "));
  assert.ok(!PROMPT.test("loading"));
  assert.ok(ENTER_UNTIL.test("[Safe Mode taken]"));
  assert.ok(ENTER_UNTIL.test(HIJACK_TEXT));
  assert.ok(RELEASE_UNTIL.test("[Safe Mode released]"));
  assert.ok(RELEASE_UNTIL.test(HIJACK_TEXT));
});

// Сырые ответы консоли F1-VLD-GW01 (RouterOS 7.23.7), прогон spikeSafeMode.js 2026-10-11
const LIVE = {
  enter: "\r[f1-hd@F1-VLD-GW01] > \r\nTaking Safe Mode session... Success!\r\n\r\u001b[9999B\r\r\r\r\u001b[9999B[f1-hd@F1-VLD-GW01] <SAFE>",
  enterTail: " \u001b[c",
  release: "\r\nReleasing Safe Mode... Success!\r\n\r\u001b[9999B\r\r\r\r\u001b[9999B[f1-hd@F1-VLD-GW01] > \rSafe Mode released",
  prompt: "Press F1 for help\r\n\r\u001b[9999B\r\u001b[9999B\r\n\r\n\r\r\r\u001b[9999B[f1-hd@F1-VLD-GW01] > ",
};

test("живые тексты RouterOS 7.23.7: вход, выход, приглашение, собственный хвост", () => {
  const c = require("./safeModeConsole");
  assert.equal(c.classifyCtrlX(LIVE.enter, { entering: true }), "taken");
  assert.equal(c.classifyCtrlX(LIVE.release, { entering: false }), "released");
  assert.ok(c.PROMPT.test(LIVE.prompt));
  assert.equal(c.lostSafeMode(LIVE.enterTail), false);
  assert.equal(c.lostSafeMode(LIVE.enter), false);
  // выход подтверждается уже первой строкой ответа, не только поздним «Safe Mode released»
  assert.equal(c.classifyCtrlX("\r\nReleasing Safe Mode... Success!\r\n", { entering: false }), "released");
  assert.equal(c.classifyCtrlX("\r\nTaking Safe Mode session... Success!\r\n", { entering: true }), "taken");
  // неудача входа или выхода — не подтверждение
  assert.equal(c.classifyCtrlX("\r\nTaking Safe Mode session... Failed!\r\n[f1-hd@F1-VLD-GW01] > ", { entering: true }), "unknown");
  assert.equal(c.classifyCtrlX("\r\nReleasing Safe Mode... Failed!\r\n", { entering: false }), "unknown");
  // слова о входе не подтверждают выход и наоборот
  assert.equal(c.classifyCtrlX(LIVE.enter, { entering: false }), "unknown");
});
