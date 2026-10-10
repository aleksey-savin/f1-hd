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
