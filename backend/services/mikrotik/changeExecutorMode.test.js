// node --test services/mikrotik/changeExecutorMode.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { executorMode, rollbackAvailable } = require("./changeExecutorMode");

const recorder = () => {
  const calls = [];
  return { calls, log: { log: (level, message, meta) => calls.push({ level, message, meta }) } };
};

test("B5: режим не задан или пуст — safe-mode, без записей в журнал", () => {
  const r = recorder();
  assert.equal(executorMode({}, r.log), "safe-mode");
  assert.equal(executorMode({ MIKROTIK_CHANGE_EXECUTOR: "" }, r.log), "safe-mode");
  assert.equal(executorMode({ MIKROTIK_CHANGE_EXECUTOR: "safe-mode" }, r.log), "safe-mode");
  assert.equal(r.calls.length, 0);
});

test("B5: api — api", () => {
  const r = recorder();
  assert.equal(executorMode({ MIKROTIK_CHANGE_EXECUTOR: "api" }, r.log), "api");
  assert.equal(executorMode({ MIKROTIK_CHANGE_EXECUTOR: " API " }, r.log), "api");
  assert.equal(r.calls.length, 0);
});

test("B5: неизвестное значение — safe-mode и ОДНА громкая запись, сколько бы раз ни спросили", () => {
  const r = recorder();
  const env = { MIKROTIK_CHANGE_EXECUTOR: "safemode-b5-typo" };
  for (let i = 0; i < 5; i += 1) assert.equal(executorMode(env, r.log), "safe-mode");
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].level, "error");
  assert.match(r.calls[0].message, /MIKROTIK_CHANGE_EXECUTOR/);
  assert.match(r.calls[0].message, /safe-mode/);
});

test("B5: без журнала не падает; запись появится, когда журнал дадут", () => {
  const env = { MIKROTIK_CHANGE_EXECUTOR: "another-b5-typo" };
  assert.equal(executorMode(env), "safe-mode");
  const r = recorder();
  assert.equal(executorMode(env, r.log), "safe-mode");
  assert.equal(r.calls.length, 1);
  // сломанный журнал режим не ломает
  assert.equal(executorMode({ MIKROTIK_CHANGE_EXECUTOR: "third-b5-typo" }, { log() { throw new Error("log is down"); } }), "safe-mode");
});

test("B4: откат обещаем только в safe-mode", () => {
  assert.equal(rollbackAvailable({}), true);
  assert.equal(rollbackAvailable({ MIKROTIK_CHANGE_EXECUTOR: "safe-mode" }), true);
  assert.equal(rollbackAvailable({ MIKROTIK_CHANGE_EXECUTOR: "api" }), false);
  assert.equal(rollbackAvailable({ MIKROTIK_CHANGE_EXECUTOR: "fourth-b5-typo" }), true);
});
