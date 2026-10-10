const { test, afterEach, after } = require("node:test");
const assert = require("node:assert/strict");

const { createExecutor } = require("./changeExecutor");

const CTRL_X = "\x18";
const PROMPT = "\r\n[admin@R] <SAFE> ";
const TAKEN = " [Safe Mode taken]\r\n[admin@R] <SAFE> ";
const RELEASED = "[Safe Mode released]\r\n[admin@R] > ";
const HIJACK = "Hijack safe mode of another user? [u/r/d]";
const LIMITS = { commandMs: 1000, totalMs: 5000, replyMs: 50, settleMs: 5000 };

// Поддельная оболочка: reads — очередь ответов (Error — таймаут чтения), drains — очередь drain()
const HANG = Symbol("hang");
const fakeHold = ({ reads = [PROMPT, TAKEN, RELEASED], drains = [], throwWrite = null, throwDrain = null } = {}) => {
  let open = true;
  const listeners = [];
  const hold = {
    opened: false,
    writes: [],
    closed: 0,
    // Смерть оболочки извне (обрыв соединения)
    die: () => {
      if (!open) return;
      open = false;
      for (const cb of listeners.splice(0)) cb();
    },
    isOpen: () => open,
    onClose: (cb) => {
      if (open) listeners.push(cb);
      else cb();
    },
    write: (text) => {
      if (throwWrite === hold.writes.length + 1) throw new Error("write failed");
      hold.writes.push(text);
    },
    read: async () => {
      const next = reads.shift();
      if (next === HANG) return new Promise(() => {});
      if (typeof next === "function") return next();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error("shell read timeout");
      return next;
    },
    drain: () => {
      if (throwDrain !== null && hold.drainCalls === throwDrain) throw new Error("drain failed");
      hold.drainCalls += 1;
      const next = drains.shift();
      return typeof next === "function" ? next() : (next ?? "");
    },
    drainCalls: 0,
    close: () => {
      hold.closed += 1;
      open = false;
    },
  };
  registry.push(hold);
  return hold;
};

// Структурная проверка: каждая оболочка, созданная fakeHold, попадает в реестр; afterEach проверяет
// все реестровые — в оболочку писались только Ctrl+X и `d`, а открытая исполнителем закрыта ровно раз.
// Гарантия: оболочка не обойдёт проверку, если создана через fakeHold; «открыта» определяет обёртка
// openHold в harness (не флаг теста), а after сверяет число проверенных открытых с числом вызовов openHold.
// Не гарантируется: оболочка, собранная в обход fakeHold, или openHold, написанный в тесте вручную.
const registry = [];
let checked = 0;
let checkedOpened = 0;
let openCalls = 0;
afterEach(() => {
  const holds = registry.splice(0);
  for (const hold of holds) {
    for (const text of hold.writes) assert.ok(text === CTRL_X || text === "d", `forbidden write ${JSON.stringify(text)}`);
    if (hold.opened) {
      assert.equal(hold.closed, 1, "hold must be closed exactly once");
      checkedOpened += 1;
    }
    checked += 1;
  }
});
after(() => {
  assert.ok(checkedOpened >= 30, `only ${checkedOpened} opened holds were checked`);
  assert.equal(checkedOpened, openCalls, "every openHold call must reach a checked hold");
});

const harness = ({ hold = fakeHold(), mode = "safe-mode", run, probes = [true], limits = LIMITS, runApi, onProbe, onSleep } = {}) => {
  const state = { sent: [], sleeps: [], probes: 0, openHolds: 0 };
  const defaultRun = async (words) => {
    state.sent.push(words);
    return [];
  };
  const doRun = run ? (words) => run(words, state) : defaultRun;
  const executor = createExecutor({
    mode,
    limits,
    openHold: async () => {
      state.openHolds += 1;
      hold.opened = true;
      openCalls += 1;
      return hold;
    },
    runApi: runApi || (async (record, fn) => fn(doRun)),
    probe: async () => {
      state.probes += 1;
      if (onProbe) await onProbe(state.probes);
      return probes.length > 1 ? probes.shift() : probes[0];
    },
    sleep: async (ms) => {
      state.sleeps.push(ms);
      if (onSleep) await onSleep(ms);
    },
    log: { warn() {}, info() {}, error() {} },
    now: () => 0,
  });
  return { executor, state, hold };
};

const items = (n) => Array.from({ length: n }, (_, i) => ({ words: [`/x/add`, `=n=${i + 1}`] }));
const states = (result) => result.results.map((r) => r.state);

test("safe mode: счастливый путь", async () => {
  const { executor, state, hold } = harness();
  const input = items(3);
  const result = await executor.applyCommands({}, input);
  assert.deepEqual(hold.writes, [CTRL_X, CTRL_X]);
  assert.deepEqual(state.sent, input.map((i) => i.words));
  assert.deepEqual(states(result), ["done", "done", "done"]);
  assert.equal(result.executor, "safe-mode");
  assert.equal(result.rolledBack, false);
  assert.equal(result.releaseConfirmed, true);
  assert.equal(result.reachable, true);
  assert.equal(result.failure, null);
});

test("safe mode: вторая из трёх отвергнута", async () => {
  const { executor, state, hold } = harness({
    run: async (words, s) => {
      s.sent.push(words);
      if (s.sent.length === 2) throw new Error("failure: already\nhave such address");
      return [];
    },
  });
  const result = await executor.applyCommands({}, items(3));
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.deepEqual(states(result), ["rolled_back", "failed", "skipped"]);
  assert.equal(result.rolledBack, true);
  assert.equal(result.releaseConfirmed, false);
  assert.equal(state.sent.length, 2);
  assert.equal(result.results[1].error, "failure: already have such address");
});

test("текст ошибки роутера: одна строка и не длиннее 300", async () => {
  const { executor } = harness({
    run: async () => {
      throw new Error(`a\r\nb\n${"z".repeat(500)}`);
    },
  });
  const result = await executor.applyCommands({}, items(1));
  assert.ok(result.results[0].error.length <= 300);
  assert.ok(!/[\r\n]/.test(result.results[0].error));
});

test("safe mode: после правок роутер молчит", async () => {
  const { executor, hold } = harness({ probes: [false] });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.deepEqual(states(result), ["rolled_back", "rolled_back"]);
  assert.equal(result.rolledBack, true);
  assert.equal(result.reachable, false);
  assert.equal(result.failure, "the device stopped answering after the change");
  assert.equal(result.releaseConfirmed, false);
});

test("safe mode: на входе вопрос о перехвате", async () => {
  const { executor, state, hold } = harness({ hold: fakeHold({ reads: [PROMPT, HIJACK] }) });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, [CTRL_X, "d"]);
  assert.equal(state.sent.length, 0);
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.equal(result.failure, "safe mode is held by another session");
  assert.equal(result.rolledBack, false);
  assert.equal(result.reachable, true);
});

test("safe mode: на входе ответ неизвестен", async () => {
  const { executor, state, hold } = harness({ hold: fakeHold({ reads: [PROMPT, "[admin@R] > "] }) });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.equal(state.sent.length, 0);
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.equal(result.failure, "could not confirm safe mode");
});

test("safe mode: приглашение не пришло — ничего не пишем", async () => {
  const { executor, state, hold } = harness({ hold: fakeHold({ reads: [] }) });
  const result = await executor.applyCommands({}, items(1));
  assert.deepEqual(hold.writes, []);
  assert.equal(state.sent.length, 0);
  assert.equal(result.failure, "could not confirm safe mode");
});

test("safe mode: оболочку открыть не удалось", async () => {
  const executor = createExecutor({
    mode: "safe-mode",
    limits: LIMITS,
    openHold: async () => {
      throw new Error("connect refused");
    },
    runApi: async () => assert.fail("no api"),
    probe: async () => true,
    sleep: async () => {},
    log: {},
    now: () => 0,
  });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.match(result.failure, /could not open/);
});

test("safe mode: после входа ждём и сбрасываем собственные остатки", async () => {
  const { executor, state } = harness({ hold: fakeHold({ drains: [" [Safe Mode taken]\r\n[admin@R] <SAFE> "] }) });
  const result = await executor.applyCommands({}, items(1));
  assert.equal(state.sleeps[0], 500);
  assert.deepEqual(states(result), ["done"]);
  assert.equal(state.sent.length, 1);
});

test("safe mode: режим потерян между правками", async () => {
  // drains: сброс после входа, перед 1-й, перед 2-й (чужое снятие)
  const { executor, state, hold } = harness({
    hold: fakeHold({ drains: ["", "", "[Safe mode released by another user]"] }),
  });
  const result = await executor.applyCommands({}, items(3));
  assert.equal(state.sent.length, 1);
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.deepEqual(states(result), ["done", "skipped", "skipped"]);
  assert.equal(result.rolledBack, false);
  assert.equal(result.releaseConfirmed, false);
  assert.equal(result.failure, "safe mode was taken over by another session; applied commands may remain");
});

test("safe mode: режим потерян перед выходом", async () => {
  const { executor, hold } = harness({ hold: fakeHold({ drains: ["", "", HIJACK] }) });
  const result = await executor.applyCommands({}, items(1));
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.deepEqual(states(result), ["done"]);
  assert.equal(result.releaseConfirmed, false);
  assert.match(result.failure, /taken over by another session/);
});

test("safe mode: ответ на выход неизвестен", async () => {
  const { executor, state, hold } = harness({ hold: fakeHold({ reads: [PROMPT, TAKEN, "[admin@R] <SAFE> "] }) });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, [CTRL_X, CTRL_X]);
  assert.deepEqual(states(result), ["done", "done"]);
  assert.equal(result.releaseConfirmed, false);
  assert.equal(result.rolledBack, false);
  assert.equal(result.failure, "release of safe mode was not confirmed; the router may have rolled the change back");
  assert.ok(state.sleeps.includes(5000));
  assert.ok(state.probes >= 2);
});

test("safe mode: на выходе вопрос о перехвате", async () => {
  const { executor, hold } = harness({ hold: fakeHold({ reads: [PROMPT, TAKEN, HIJACK] }) });
  const result = await executor.applyCommands({}, items(1));
  assert.deepEqual(hold.writes, [CTRL_X, CTRL_X, "d"]);
  assert.deepEqual(states(result), ["done"]);
  assert.equal(result.releaseConfirmed, false);
  assert.equal(result.failure, "safe mode was taken over by another session before release; applied commands may remain");
});

test("safe mode: команда не отвечает — таймаут, поздний ответ ничего не шлёт", async () => {
  let late;
  const { executor, state, hold } = harness({
    limits: { ...LIMITS, commandMs: 20 },
    run: (words, s) => {
      s.sent.push(words);
      if (s.sent.length === 2) return new Promise((resolve) => (late = resolve));
      return Promise.resolve([]);
    },
  });
  const result = await executor.applyCommands({}, items(3));
  assert.deepEqual(states(result), ["rolled_back", "failed", "skipped"]);
  assert.match(result.results[1].error, /timed out/);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(hold.writes, [CTRL_X]);
  late([]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(state.sent.length, 2);
  assert.deepEqual(hold.writes, [CTRL_X]);
});

test("safe mode: общий дедлайн", async () => {
  const { executor, state, hold } = harness({
    limits: { ...LIMITS, commandMs: 1000, totalMs: 30 },
    run: (words, s) => {
      s.sent.push(words);
      if (s.sent.length === 2) return new Promise(() => {});
      return Promise.resolve([]);
    },
  });
  const result = await executor.applyCommands({}, items(3));
  assert.deepEqual(states(result), ["rolled_back", "failed", "skipped"]);
  assert.match(result.results[1].error, /timed out/);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.equal(state.sent.length, 2);
});

test("safe mode: runApi вызывает fn слишком поздно — ничего не пишется", async () => {
  let lateFn;
  const { executor, state, hold } = harness({
    limits: { ...LIMITS, totalMs: 30 },
    runApi: (record, fn) => new Promise(() => (lateFn = fn)),
  });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  await lateFn(async (words) => state.sent.push(words));
  assert.equal(state.sent.length, 0);
  assert.deepEqual(hold.writes, [CTRL_X]);
});

test("safe mode: сессия API не открылась", async () => {
  const { executor, state, hold } = harness({
    runApi: async () => {
      throw new Error("login failure");
    },
  });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.match(result.failure, /login failure/);
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.equal(state.sent.length, 0);
});

test("api: счастливый путь", async () => {
  const { executor, state } = harness({ mode: "api" });
  const input = items(2);
  const result = await executor.applyCommands({}, input);
  assert.deepEqual(state.sent, input.map((i) => i.words));
  assert.deepEqual(states(result), ["done", "done"]);
  assert.equal(result.executor, "api");
  assert.equal(result.rolledBack, false);
  assert.equal(result.releaseConfirmed, true);
  assert.equal(result.reachable, true);
  assert.equal(result.failure, null);
  assert.equal(state.openHolds, 0);
});

test("api: первая ошибка останавливает", async () => {
  const { executor, state } = harness({
    mode: "api",
    run: async (words, s) => {
      s.sent.push(words);
      if (s.sent.length === 2) throw new Error("no such item");
      return [];
    },
  });
  const result = await executor.applyCommands({}, items(3));
  assert.deepEqual(states(result), ["done", "failed", "skipped"]);
  assert.equal(result.rolledBack, false);
  assert.equal(result.results[1].error, "no such item");
  assert.equal(state.sent.length, 2);
  assert.equal(state.probes, 1);
});

test("api: таймаут команды", async () => {
  const { executor } = harness({ mode: "api", limits: { ...LIMITS, commandMs: 20 }, run: () => new Promise(() => {}) });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(states(result), ["failed", "skipped"]);
  assert.match(result.results[0].error, /timed out/);
});

test("результат всегда с шестью полями", async () => {
  const { executor } = harness({ mode: "api" });
  const result = await executor.applyCommands({}, items(1));
  assert.deepEqual(Object.keys(result).sort(), ["executor", "failure", "reachable", "releaseConfirmed", "results", "rolledBack"]);
});

// ---- раунд 1 ----

test("создание: неизвестный режим — ошибка", () => {
  assert.throws(() => createExecutor({ mode: "fast" }), /unknown executor mode/);
  assert.throws(() => createExecutor({ mode: null }), /unknown executor mode/);
});

test("C1: оболочка умерла во время первой команды, а та успела ответить", async () => {
  const hold = fakeHold();
  const { executor, state } = harness({
    hold,
    run: async (words, s) => {
      s.sent.push(words);
      hold.die();
      return [];
    },
  });
  const result = await executor.applyCommands({}, items(3));
  assert.equal(state.sent.length, 1);
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.deepEqual(states(result), ["failed", "skipped", "skipped"]);
  assert.equal(result.rolledBack, true);
  assert.equal(result.releaseConfirmed, false);
  assert.equal(result.failure, "the safe mode session was lost; the router rolls the change back");
});

test("C1: оболочка умерла в паузе между правками — вторая не уходит", async () => {
  const hold = fakeHold({
    drains: [
      "",
      "",
      () => {
        hold.die();
        return "";
      },
    ],
  });
  const { executor, state } = harness({ hold });
  const result = await executor.applyCommands({}, items(3));
  assert.equal(state.sent.length, 1);
  assert.deepEqual(states(result), ["rolled_back", "skipped", "skipped"]);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(hold.writes, [CTRL_X]);
});

test("C1: оболочка умерла во время команды — она failed", async () => {
  const hold = fakeHold();
  const { executor, state } = harness({
    hold,
    run: (words, s) => {
      s.sent.push(words);
      if (s.sent.length === 2) {
        hold.die();
        return new Promise(() => {});
      }
      return Promise.resolve([]);
    },
  });
  const result = await executor.applyCommands({}, items(3));
  assert.deepEqual(states(result), ["rolled_back", "failed", "skipped"]);
  assert.equal(result.results[1].error, "the safe mode session was lost");
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.equal(state.sent.length, 2);
});

test("C1: оболочка умерла после всех правок до выхода — второго Ctrl+X нет", async () => {
  const hold = fakeHold();
  const { executor } = harness({ hold, onProbe: (n) => n === 1 && hold.die() });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.deepEqual(states(result), ["rolled_back", "rolled_back"]);
  assert.equal(result.rolledBack, true);
  assert.equal(result.releaseConfirmed, false);
  assert.equal(result.failure, "the safe mode session was lost; the router rolls the change back");
});

test("C1: оболочка уже закрыта к моменту onClose", async () => {
  const hold = fakeHold();
  hold.die();
  const { executor, state } = harness({ hold });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, []);
  assert.equal(state.sent.length, 0);
  assert.deepEqual(states(result), ["skipped", "skipped"]);
});

test("I1: write на входе бросает", async () => {
  const hold = fakeHold({ throwWrite: 1 });
  const { executor, state } = harness({ hold });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(state.sent.length, 0);
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.match(result.failure, /^unexpected error while applying: write failed/);
  assert.equal(result.releaseConfirmed, false);
});

test("I1: drain после входа бросает", async () => {
  const hold = fakeHold({ throwDrain: 0 });
  const { executor, state } = harness({ hold });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(state.sent.length, 0);
  assert.match(result.failure, /^unexpected error while applying: drain failed/);
});

test("I1: drain между правками бросает", async () => {
  const hold = fakeHold({ throwDrain: 2 });
  const { executor, state } = harness({ hold });
  const result = await executor.applyCommands({}, items(3));
  assert.equal(state.sent.length, 1);
  assert.deepEqual(states(result), ["rolled_back", "skipped", "skipped"]);
  assert.match(result.failure, /^unexpected error while applying: drain failed/);
  assert.equal(result.rolledBack, true);
});

test("I1: write на выходе бросает", async () => {
  const hold = fakeHold({ throwWrite: 2 });
  const { executor } = harness({ hold });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.deepEqual(states(result), ["done", "done"]);
  assert.equal(result.releaseConfirmed, false);
  assert.match(result.failure, /^unexpected error while applying: write failed/);
});

test("I1: openHold отклонён", async () => {
  const executor = createExecutor({
    mode: "safe-mode",
    limits: LIMITS,
    openHold: async () => {
      throw new Error("connect\nrefused");
    },
    runApi: async () => assert.fail("no api"),
    probe: async () => true,
    sleep: async () => {},
  });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(result.rolledBack, false);
  assert.equal(result.failure, "could not open a console session: connect refused");
});

test("I2: api — отвергнутая команда", async () => {
  const { executor } = harness({
    mode: "api",
    run: async (words, s) => {
      s.sent.push(words);
      if (s.sent.length === 2) throw new Error("no such item");
      return [];
    },
  });
  const result = await executor.applyCommands({}, items(3));
  assert.equal(result.failure, "command 2 failed: no such item; earlier commands stay applied");
});

test("I2: api — зависшая сессия до дедлайна", async () => {
  const { executor } = harness({ mode: "api", limits: { ...LIMITS, totalMs: 30 }, runApi: () => new Promise(() => {}) });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.equal(result.failure, "timed out; 0 of 2 commands were applied");
  assert.equal(result.releaseConfirmed, true);
});

test("I2: api — сессию открыть не удалось", async () => {
  const { executor } = harness({
    mode: "api",
    runApi: async () => {
      throw new Error("login failure");
    },
  });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.match(result.failure, /login failure/);
});

test("I2: api — любой не-done даёт непустой failure", async () => {
  const { executor } = harness({ mode: "api", limits: { ...LIMITS, commandMs: 20 }, run: () => new Promise(() => {}) });
  const result = await executor.applyCommands({}, items(2));
  assert.ok(result.failure);
});

test("I3: дедлайн до первой команды", async () => {
  const hold = fakeHold();
  const { executor } = harness({ hold, limits: { ...LIMITS, totalMs: 30 }, runApi: () => new Promise(() => {}) });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.equal(result.rolledBack, false);
  assert.equal(result.failure, "timed out before any command was sent");
});

test("I3: таймаут команды", async () => {
  const hold = fakeHold();
  const { executor } = harness({ hold, limits: { ...LIMITS, commandMs: 20 }, run: () => new Promise(() => {}) });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(result.failure, "command 1 timed out; safe mode was dropped and the router rolls the change back");
});

test("I3: дедлайн во время команды", async () => {
  const { executor } = harness({ limits: { ...LIMITS, totalMs: 30 }, run: () => new Promise(() => {}) });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(result.failure, "command 1 timed out; safe mode was dropped and the router rolls the change back");
  assert.equal(result.rolledBack, true);
});

test("I3: отвергнутая команда", async () => {
  const hold = fakeHold();
  const { executor } = harness({
    hold,
    run: async () => {
      throw new Error("bad value");
    },
  });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(result.failure, "command 1 failed: bad value; safe mode was dropped and the router rolls the change back");
});

test("I3: API-сессия после safe mode не открылась", async () => {
  const hold = fakeHold();
  const { executor } = harness({
    hold,
    runApi: async () => {
      throw new Error("login failure");
    },
  });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(result.failure, "could not open the API session: login failure");
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.equal(result.rolledBack, false);
  assert.deepEqual(hold.writes, [CTRL_X]);
});

test("минор: чужое снятие в паузе после входа — ничего не шлём", async () => {
  const hold = fakeHold({ drains: ["[Safe Mode taken by another user]"] });
  const { executor, state } = harness({ hold });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(state.sent.length, 0);
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.equal(result.failure, "safe mode was taken over by another session");
  assert.deepEqual(hold.writes, [CTRL_X]);
});

test("минор: дедлайн во время проверки после правок", async () => {
  const hold = fakeHold();
  const { executor } = harness({
    hold,
    limits: { ...LIMITS, totalMs: 30, commandMs: 50 },
    onProbe: (n) => (n === 1 ? new Promise(() => {}) : undefined),
  });
  const result = await executor.applyCommands({}, items(1));
  assert.match(result.failure, /^timed out while checking the device/);
  assert.notEqual(result.failure, "the device stopped answering after the change");
  assert.deepEqual(hold.writes, [CTRL_X]);
});

test("минор: дедлайн во время входа", async () => {
  const hold = fakeHold({ reads: [PROMPT, HANG] });
  const { executor, state } = harness({ hold, limits: { ...LIMITS, totalMs: 30, replyMs: 1000 } });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(state.sent.length, 0);
  assert.deepEqual(states(result), ["skipped", "skipped"]);
});

test("минор: дедлайн во время выхода", async () => {
  const hold = fakeHold({ reads: [PROMPT, TAKEN, HANG] });
  const { executor } = harness({ hold, limits: { ...LIMITS, totalMs: 40, replyMs: 1000 } });
  const result = await executor.applyCommands({}, items(1));
  assert.deepEqual(hold.writes, [CTRL_X, CTRL_X]);
  assert.deepEqual(states(result), ["done"]);
  assert.equal(result.releaseConfirmed, false);
});

// ---- раунд 2 ----

// runApi, вернувшаяся не доведя fn до конца
const neverCalls = async () => {};
const returnsEarly = (state) => (record, fn) => {
  state.sent = [];
  fn((words) => {
    state.sent.push(words);
    return new Promise((resolve) => (state.finishLate = resolve));
  });
  return Promise.resolve();
};
const ENDED_UNCONFIRMED = (n) => `the API session ended before command ${n} was confirmed; it may have been applied`;
const SESSION_ENDED = "the API session ended before all commands were sent";

test("R1: safe mode — runApi вернулась, не вызвав fn", async () => {
  const hold = fakeHold();
  const { executor, state } = harness({ hold, runApi: neverCalls });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.equal(state.probes, 1);
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.equal(result.rolledBack, false);
  assert.equal(result.releaseConfirmed, false);
  assert.equal(result.failure, SESSION_ENDED);
});

test("R1: safe mode — runApi вернулась раньше, чем fn закончила", async () => {
  const shared = {};
  const { executor, hold } = harness({ runApi: returnsEarly(shared) });
  const result = await executor.applyCommands({}, items(3));
  assert.deepEqual(states(result), ["failed", "skipped", "skipped"]);
  assert.equal(result.results[0].error, "not confirmed");
  assert.equal(result.rolledBack, true);
  assert.equal(result.failure, ENDED_UNCONFIRMED(1));
  assert.deepEqual(hold.writes, [CTRL_X]);
  shared.finishLate([]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(shared.sent.length, 1);
  assert.deepEqual(hold.writes, [CTRL_X]);
});

test("R1: safe mode — fn вызвана дважды, правки уходят по одному разу", async () => {
  const { executor, state, hold } = harness({
    runApi: async (record, fn) => {
      const run = async (words) => {
        state.sent.push(words);
        return [];
      };
      await fn(run);
      await fn(run);
    },
  });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(state.sent.length, 2);
  assert.deepEqual(states(result), ["done", "done"]);
  assert.deepEqual(hold.writes, [CTRL_X, CTRL_X]);
  assert.equal(result.releaseConfirmed, true);
});

test("R1: api — runApi вернулась, не вызвав fn", async () => {
  const { executor } = harness({ mode: "api", runApi: neverCalls });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.equal(result.failure, SESSION_ENDED);
});

test("R1: api — runApi вернулась раньше, чем fn закончила", async () => {
  const shared = {};
  const { executor } = harness({ mode: "api", runApi: returnsEarly(shared) });
  const result = await executor.applyCommands({}, items(3));
  assert.deepEqual(states(result), ["failed", "skipped", "skipped"]);
  assert.equal(result.results[0].error, "not confirmed");
  assert.equal(result.failure, ENDED_UNCONFIRMED(1));
  shared.finishLate([]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(shared.sent.length, 1);
});

test("R1: api — fn вызвана дважды", async () => {
  const { executor, state } = harness({
    mode: "api",
    runApi: async (record, fn) => {
      const run = async (words) => {
        state.sent.push(words);
        return [];
      };
      await fn(run);
      await fn(run);
    },
  });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(state.sent.length, 2);
  assert.deepEqual(states(result), ["done", "done"]);
  assert.equal(result.failure, null);
});

test("R3: оболочка умерла после входа, до первой команды", async () => {
  const hold = fakeHold({
    drains: [
      "",
      () => {
        hold.die();
        return "";
      },
    ],
  });
  const { executor, state } = harness({ hold });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(state.sent.length, 0);
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.equal(result.rolledBack, false);
  assert.equal(result.failure, "the safe mode session was lost before any command was sent");
});

test("R3: оболочка умерла в паузе после входа", async () => {
  const hold = fakeHold();
  const { executor, state } = harness({ hold, onSleep: (ms) => ms === 500 && hold.die() });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(state.sent.length, 0);
  assert.equal(result.rolledBack, false);
  assert.equal(result.failure, "the safe mode session was lost before any command was sent");
});

test("R3: отказ `d` в мёртвую оболочку не пишется", async () => {
  const hold = fakeHold({
    reads: [
      PROMPT,
      () => {
        hold.die();
        return HIJACK;
      },
    ],
  });
  const { executor } = harness({ hold });
  const result = await executor.applyCommands({}, items(1));
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.equal(result.failure, "safe mode is held by another session");
});

test("R3: runApi отклонилась после всех команд — safe mode", async () => {
  const { executor, hold } = harness({
    runApi: async (record, fn) => {
      await fn(async () => []);
      throw new Error("connection reset");
    },
  });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.deepEqual(states(result), ["rolled_back", "rolled_back"]);
  assert.equal(result.rolledBack, true);
  assert.equal(result.releaseConfirmed, false);
  assert.equal(result.failure, "the API session failed after the commands were sent: connection reset");
});

test("R3: runApi отклонилась после всех команд — api", async () => {
  const { executor } = harness({
    mode: "api",
    runApi: async (record, fn) => {
      await fn(async () => []);
      throw new Error("connection reset");
    },
  });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(states(result), ["done", "done"]);
  assert.equal(result.failure, "the API session failed after the commands were sent: connection reset");
});

test("R4: поздний reject команды после смерти оболочки", async () => {
  const hold = fakeHold();
  let lateReject;
  const { executor, state } = harness({
    hold,
    run: (words, s) => {
      s.sent.push(words);
      if (s.sent.length === 2) {
        hold.die();
        return new Promise((resolve, reject) => (lateReject = reject));
      }
      return Promise.resolve([]);
    },
  });
  const result = await executor.applyCommands({}, items(3));
  assert.deepEqual(states(result), ["rolled_back", "failed", "skipped"]);
  lateReject(new Error("too late"));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(state.sent.length, 2);
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.equal(result.results[1].error, "the safe mode session was lost");
});

test("R4: смерть оболочки в drain перед выходом", async () => {
  const hold = fakeHold({
    drains: [
      "",
      "",
      "",
      () => {
        hold.die();
        return "";
      },
    ],
  });
  const { executor } = harness({ hold });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.deepEqual(states(result), ["rolled_back", "rolled_back"]);
  assert.equal(result.failure, "the safe mode session was lost; the router rolls the change back");
});

test("R4: смерть оболочки во время чтения ответа на выход", async () => {
  const hold = fakeHold({
    reads: [
      PROMPT,
      TAKEN,
      () => {
        hold.die();
        return new Promise(() => {});
      },
    ],
  });
  const { executor } = harness({ hold });
  const result = await executor.applyCommands({}, items(2));
  assert.deepEqual(hold.writes, [CTRL_X, CTRL_X]);
  assert.deepEqual(states(result), ["done", "done"]);
  assert.equal(result.releaseConfirmed, false);
  assert.equal(result.failure, "release of safe mode was not confirmed; the router may have rolled the change back");
});

test("R4: onClose срабатывает несколько раз", async () => {
  const hold = fakeHold();
  let fire;
  hold.onClose = (cb) => {
    fire = cb;
  };
  const { executor, state } = harness({
    hold,
    run: async (words, s) => {
      s.sent.push(words);
      fire();
      fire();
      fire();
      return [];
    },
  });
  hold.isOpen = () => state.sent.length === 0;
  const result = await executor.applyCommands({}, items(3));
  assert.equal(state.sent.length, 1);
  assert.deepEqual(hold.writes, [CTRL_X]);
  assert.equal(result.rolledBack, true);
});

// ---- раунд 3 ----

const sleepTick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
// runApi возвращается, когда 1-я правка подтверждена, а 2-я в полёте
const returnsWithSecondInFlight = (record, fn) => {
  let n = 0;
  fn(() => {
    n += 1;
    return n === 1 ? Promise.resolve([]) : new Promise(() => {});
  });
  return sleepTick();
};

test("R5: safe mode — одна подтверждена, вторая в полёте, runApi вернулась", async () => {
  const { executor, hold } = harness({ runApi: returnsWithSecondInFlight });
  const result = await executor.applyCommands({}, items(3));
  assert.deepEqual(states(result), ["rolled_back", "failed", "skipped"]);
  assert.equal(result.results[1].error, "not confirmed");
  assert.equal(result.failure, ENDED_UNCONFIRMED(2));
  assert.equal(result.rolledBack, true);
  assert.deepEqual(hold.writes, [CTRL_X]);
});

test("R5: api — одна подтверждена, вторая в полёте, runApi вернулась", async () => {
  const { executor } = harness({ mode: "api", runApi: returnsWithSecondInFlight });
  const result = await executor.applyCommands({}, items(3));
  assert.deepEqual(states(result), ["done", "failed", "skipped"]);
  assert.equal(result.results[1].error, "not confirmed");
  assert.equal(result.failure, ENDED_UNCONFIRMED(2));
});

test("R5: fn вызвана дважды одновременно — каждая правка один раз", async () => {
  for (const mode of ["safe-mode", "api"]) {
    const sent = [];
    const { executor } = harness({
      mode,
      runApi: async (record, fn) => {
        const run = async (words) => {
          sent.push(words);
          await sleepTick(5);
          return [];
        };
        await Promise.all([fn(run), fn(run)]);
      },
    });
    const result = await executor.applyCommands({}, items(3));
    assert.equal(sent.length, 3, mode);
    assert.deepEqual(states(result), ["done", "done", "done"], mode);
  }
});

test("R5: оболочка умерла, пока runApi ещё подключается", async () => {
  const hold = fakeHold();
  const { executor } = harness({
    hold,
    limits: { ...LIMITS, totalMs: 2000 },
    runApi: () => {
      setTimeout(() => hold.die(), 10);
      return new Promise(() => {});
    },
  });
  const started = Date.now();
  const result = await executor.applyCommands({}, items(2));
  assert.ok(Date.now() - started < 1000, "must not wait for the deadline");
  assert.deepEqual(states(result), ["skipped", "skipped"]);
  assert.equal(result.rolledBack, false);
  assert.equal(result.failure, "the safe mode session was lost before any command was sent");
});

test("R2: пустой список — ничего не открываем", async () => {
  for (const input of [[], null, undefined, "x"]) {
    for (const mode of ["safe-mode", "api"]) {
      let apiCalls = 0;
      const { executor, state } = harness({
        mode,
        runApi: async () => {
          apiCalls += 1;
        },
      });
      const result = await executor.applyCommands({}, input);
      assert.equal(state.openHolds, 0);
      assert.equal(apiCalls, 0);
      assert.equal(state.probes, 1);
      assert.deepEqual(result.results, []);
      assert.equal(result.rolledBack, false);
      assert.equal(result.releaseConfirmed, false);
      assert.equal(result.reachable, true);
      assert.equal(result.failure, "no commands to apply");
    }
  }
});

test("R3: дедлайн в паузе после входа", async () => {
  const hold = fakeHold();
  const { executor, state } = harness({
    hold,
    limits: { ...LIMITS, totalMs: 30 },
    onSleep: (ms) => (ms === 500 ? new Promise(() => {}) : undefined),
  });
  const result = await executor.applyCommands({}, items(2));
  assert.equal(state.sent.length, 0);
  assert.equal(result.rolledBack, false);
  assert.equal(result.failure, "timed out before any command was sent");
});

test("refused: только ответ роутера (!trap) помечается, транспортная ошибка и таймаут — нет", async () => {
  const trap = Object.assign(new Error("failure: already have such entry"), { trap: true });
  const a = harness({ mode: "api", run: async () => { throw trap; } });
  const refused = await a.executor.applyCommands({}, items(1));
  assert.equal(refused.results[0].refused, true);
  const b = harness({ mode: "api", run: async () => { throw new Error("Socket timeout"); } });
  const transport = await b.executor.applyCommands({}, items(1));
  assert.equal(transport.results[0].state, "failed");
  assert.equal(transport.results[0].refused, undefined);
});

test("refused: safe mode — !trap помечается, таймаут чтения нет", async () => {
  const trap = Object.assign(new Error("failure: nope"), { trap: true });
  const a = harness({ run: async () => { throw trap; } });
  const refused = await a.executor.applyCommands({}, items(1));
  assert.equal(refused.results[0].state, "failed");
  assert.equal(refused.results[0].refused, true);
  const b = harness({ run: async () => { throw new Error("read timeout"); } });
  const timedOut = await b.executor.applyCommands({}, items(1));
  assert.equal(timedOut.results[0].refused, undefined);
});
