// node --test services/mikrotik/changeFlow.test.js
// Сквозной путь запроса на НАСТОЯЩИХ модулях: инструмент MCP → приём → решения → воркер → уведомления.
// Заглушки только на краях ввода-вывода: хранилище в памяти (одно на контракты приёма, решений, воркера
// и чтения инструментов), чтение разделов роутера, исполнитель, бэкап, записывающий уведомитель.
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createMikrotikChangeTools } = require("../mcp/mikrotikChangeTools");
const { createProposals } = require("./changeProposals");
const { createDecisions } = require("./changeDecisions");
const { createChangeWorker } = require("./changeWorker");
const { STATUS, isFinal, isOpen } = require("./changeSteps");

const START = new Date("2026-10-10T10:00:00Z");
const MINUTE = 60 * 1000;
const AL = "/ip firewall address-list";
const DEVICE = "66aa00000000000000000001";
const REQ = "66bb00000000000000000001";
const RESP = "66bb00000000000000000002";
const TELEGRAM = { 111222333: REQ, 444555666: RESP };
const NAMES = { [REQ]: "Иван Петров", [RESP]: "Анна Смирнова" };
const CALLER = { keyId: "66cc00000000000000000001", keyName: "OpenClaw" };
const clone = (v) => structuredClone(v);
const text = (result) => result.content[0].text;

// Мир одного сценария: хранилище, роутер, часы, журналы вызовов
function world({ responsibleId = RESP, approvers = [RESP] } = {}) {
  const w = {
    clock: START,
    docs: new Map(),
    seq: 0,
    rows: { [AL]: [{ ".id": "*A", list: "vpn", address: "10.0.0.5", disabled: "false" }] },
    notes: [],
    execCalls: [],
    backups: [],
    order: [],
  };
  const now = () => w.clock;
  const all = () => [...w.docs.values()];
  const setPath = (doc, path, value) => {
    const keys = path.split(".");
    let cur = doc;
    for (const key of keys.slice(0, -1)) {
      cur[key] = cur[key] ?? {};
      cur = cur[key];
    }
    cur[keys.at(-1)] = clone(value);
  };

  // Одно хранилище в памяти на все четыре контракта (приём, решения, воркер, чтение инструментов)
  const store = {
    // --- приём (changeProposals)
    findDevice: async (name) => (name === "GW01" || name === DEVICE ? { device: { _id: DEVICE, name: "GW01", responsibleId } } : { error: "no such device" }),
    findUserByTelegram: async (id) => (TELEGRAM[id] ? { _id: TELEGRAM[id] } : null),
    canApprove: async (id) => approvers.includes(String(id)),
    countOpen: async (deviceId) => all().filter((d) => d.mikrotik === deviceId && !isFinal(d.status)).length,
    countRecentByKey: async (keyId, since) => all().filter((d) => d.requestedVia.keyId === keyId && d.createdAt >= since).length,
    nextNumber: async () => (w.seq += 1),
    create: async (doc) => {
      const saved = { ...clone(doc), _id: `66dd${String(doc.number).padStart(20, "0")}`, createdAt: now(), updatedAt: now() };
      w.docs.set(saved._id, saved);
      return clone(saved);
    },
    // --- решения (changeDecisions)
    load: async (id) => (w.docs.has(id) ? clone(w.docs.get(id)) : null),
    userName: async (id) => NAMES[id] || "",
    applyPatch: async (id, expectedStatus, index, { status, step, timeline }) => {
      const d = w.docs.get(id);
      if (!d || d.status !== expectedStatus || d.steps[index].decision) return null;
      Object.assign(d.steps[index], { decision: step.decision, channel: step.channel, comment: step.comment, decidedAt: step.decidedAt });
      d.status = status;
      d.timeline.push(clone(timeline));
      d.updatedAt = now();
      return clone(d);
    },
    applyCancel: async (id, expectedStatus, { timeline }) => {
      const d = w.docs.get(id);
      if (!d || d.status !== expectedStatus) return null;
      d.status = STATUS.cancelled;
      d.timeline.push(clone(timeline));
      return clone(d);
    },
    // --- воркер (changeWorker)
    listQueued: async () => all().filter((d) => d.status === STATUS.queued).sort((a, b) => a.createdAt - b.createdAt).map(clone),
    loadDevice: async (id) => (id === DEVICE ? { record: { _id: DEVICE, credentials: { host: "203.0.113.7", user: "hd" } }, jump: null } : null),
    finishedSince: async () => false,
    hasApplying: async (deviceId) => all().some((d) => d.mikrotik === deviceId && d.status === STATUS.applying),
    ensureQueuedSince: async (id, at) => {
      const d = w.docs.get(id);
      if (!d.queuedSince) d.queuedSince = at;
      return d.queuedSince;
    },
    claim: async (id, at) => {
      const d = w.docs.get(id);
      if (!d || d.status !== STATUS.queued) return null;
      d.status = STATUS.applying;
      d.applyingSince = at;
      return clone(d);
    },
    update: async (id, { from, set = {}, unset = [], timeline = [] }) => {
      const d = w.docs.get(id);
      if (!d || d.status !== from) return null;
      for (const [path, value] of Object.entries(set)) setPath(d, path, value);
      for (const name of unset) delete d[name];
      d.timeline.push(...timeline.map(clone));
      d.updatedAt = now();
      return clone(d);
    },
    findStale: async () => [],
    findExpired: async (at) => all().filter((d) => isOpen(d.status) && d.expiresAt <= at).map(clone),
    findDueReminders: async () => [],
    markReminded: async () => null,
    purgeKeys: async () => 0,
    // --- чтение инструментов MCP (mikrotikChangeTools)
    listDevices: async () => [{ _id: DEVICE, name: "GW01", label: null, host: "203.0.113.7" }],
    findChange: async (ref) => clone(all().find((d) => String(d.number) === ref || d._id === ref) || null),
    listChanges: async () => all().map(clone),
    people: async (ids) => new Map(ids.filter((id) => NAMES[id]).map((id) => [id, NAMES[id]])),
    artifactTime: async () => START,
  };

  // Край: роутер. Чтение отдаёт текущие строки, исполнитель «выполняет» add
  const readMenus = async (deviceId, paths) => new Map(paths.map((p) => [p, w.rows[p] ? { rows: clone(w.rows[p]) } : { error: "no such command prefix", menu: true }]));
  const executor = {
    applyCommands: async (record, items) => {
      w.order.push("executor");
      w.execCalls.push(clone(items));
      for (const { words } of items) {
        const [head, ...rest] = words;
        if (!head.endsWith("/add")) continue;
        const row = Object.fromEntries(rest.map((word) => word.slice(1).split(/=(.*)/s).slice(0, 2)));
        w.rows[AL].push({ ".id": `*N${w.rows[AL].length}`, disabled: "false", ...row });
      }
      return { executor: "safe-mode", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: null, releaseConfirmed: true };
    },
  };
  const backup = async (record, opts) => {
    w.order.push("backup");
    w.backups.push(opts);
    return { _id: "66ee00000000000000000001" };
  };
  // Край: уведомления. Записывает событие, статус и чей шаг был текущим
  const waiting = (c) => (isOpen(c.status) ? (c.steps.find((s) => !s.decision)?.user ?? null) : null);
  const record = (event) => async (c) => void w.notes.push({ event, number: c.number, status: c.status, to: waiting(c) });
  const notifier = { step: record("step"), decided: record("decided"), result: record("result"), cancelled: record("cancelled"), expired: record("expired"), reminder: record("reminder") };
  const log = { log() {} };

  w.tools = createMikrotikChangeTools({
    proposals: createProposals({ store, readMenus, now }),
    store,
    notifier,
    baseUrl: "https://hd.example.ru",
    log: () => {},
  });
  w.decisions = createDecisions({ store, notifier, now, log });
  w.worker = createChangeWorker({ store, readMenus, executor, backup, notifier, keys: {}, now, log, sleep: async () => {} });
  w.only = () => all()[0];
  w.pass = (minutes) => { w.clock = new Date(w.clock.getTime() + minutes * MINUTE); };
  return w;
}

const INPUT = {
  device: "GW01",
  requester: 111222333,
  title: "Доступ к VPN для Ивана",
  reason: "Попросил Иван Петров в Telegram",
  commands: [{ path: AL, action: "add", params: { list: "vpn", address: "10.0.0.9", comment: "ivan" } }],
};

const propose = async (w, input = INPUT) => {
  const result = await w.tools.propose(input, CALLER);
  assert.ok(!result.isError, text(result));
  return w.only();
};
const decide = (w, change, userId, decision, canApprove) =>
  w.decisions.decide({ changeId: change._id, userId, decision, channel: "portal", comment: undefined, canApprove });

test("два шага: предложение → заявителю → подтверждение → ответственному → утверждение → очередь → применено → итог", async () => {
  const w = world();
  const created = await propose(w);
  assert.equal(created.status, STATUS.awaitingRequester);
  // о новом запросе узнаёт человек первого шага — сразу после приёма
  assert.deepEqual(w.notes, [{ event: "step", number: 1, status: STATUS.awaitingRequester, to: REQ }]);
  assert.match(text(await w.tools.get({ change: "1" }, CALLER)), /waiting for: Иван Петров/);

  w.pass(2);
  const first = await decide(w, created, REQ, "approve", false);
  assert.equal(first.ok, true);
  assert.equal(first.change.status, STATUS.awaitingResponsible);
  assert.deepEqual(w.notes.at(-1), { event: "step", number: 1, status: STATUS.awaitingResponsible, to: RESP });
  // до второго решения воркер ничего не берёт
  assert.equal(await w.worker.tick(), null);
  assert.equal(w.execCalls.length, 0);

  w.pass(3);
  const second = await decide(w, created, RESP, "approve", true);
  assert.equal(second.ok, true);
  assert.equal(second.change.status, STATUS.queued);
  assert.equal(w.notes.length, 2, "утверждение последнего шага отдельного уведомления не шлёт");

  w.pass(1);
  const outcome = await w.worker.tick();
  assert.equal(outcome.status, STATUS.applied);
  const done = w.only();
  assert.equal(done.status, STATUS.applied);
  assert.deepEqual(w.order, ["backup", "executor"]);
  assert.equal(String(w.backups[0].userId), RESP);
  assert.deepEqual(w.execCalls, [[{ words: ["/ip/firewall/address-list/add", "=list=vpn", "=address=10.0.0.9", "=comment=ivan"] }]]);
  assert.equal(done.commands[0].result.state, "done");
  assert.deepEqual(w.notes.at(-1), { event: "result", number: 1, status: STATUS.applied, to: null });
  assert.deepEqual(w.notes.map((n) => n.event), ["step", "step", "result"]);
  assert.deepEqual(done.timeline.map((t) => t.kind), ["proposed", "decision", "decision", "backup", "result"]);
  // агент видит итог
  assert.match(text(await w.tools.get({ change: "1" }, CALLER)), /status: applied/);
  // повторный тик ничего не делает
  assert.equal(await w.worker.tick(), null);
  assert.equal(w.execCalls.length, 1);
});

test("один шаг: ответственного нет, заявитель с правом — предложение → утверждение → применено", async () => {
  const w = world({ responsibleId: null, approvers: [REQ] });
  const created = await propose(w);
  assert.equal(created.steps.length, 1);
  assert.deepEqual(w.notes, [{ event: "step", number: 1, status: STATUS.awaitingRequester, to: REQ }]);
  // без права единственный шаг не утвердить
  assert.equal((await decide(w, created, REQ, "approve", false)).code, "no_right");
  const approved = await decide(w, created, REQ, "approve", true);
  assert.equal(approved.change.status, STATUS.queued);
  assert.equal(w.notes.length, 1);
  assert.equal((await w.worker.tick()).status, STATUS.applied);
  assert.deepEqual(w.notes.map((n) => [n.event, n.status]), [["step", STATUS.awaitingRequester], ["result", STATUS.applied]]);
  assert.equal(w.execCalls.length, 1);
});

test("отклонение на втором шаге: уведомление о решении, воркер ничего не применяет", async () => {
  const w = world();
  const created = await propose(w);
  await decide(w, created, REQ, "approve", false);
  const rejected = await decide(w, created, RESP, "reject", true);
  assert.equal(rejected.change.status, STATUS.rejected);
  assert.deepEqual(w.notes.map((n) => [n.event, n.status]), [["step", STATUS.awaitingRequester], ["step", STATUS.awaitingResponsible], ["decided", STATUS.rejected]]);
  assert.equal(await w.worker.tick(), null);
  assert.equal(w.execCalls.length, 0);
  assert.equal(w.backups.length, 0);
  assert.equal(w.rows[AL].length, 1);
  // решение окончательное: второй раз решить нельзя
  assert.equal((await decide(w, created, RESP, "approve", true)).code, "closed");
});

test("утверждение устарело: backend стоял дольше 30 минут — not_applied, на роутер ничего не ушло", async () => {
  const w = world();
  const created = await propose(w);
  await decide(w, created, REQ, "approve", false);
  await decide(w, created, RESP, "approve", true);
  assert.equal(w.only().status, STATUS.queued);
  w.pass(31);
  const outcome = await w.worker.tick();
  assert.equal(outcome.status, STATUS.notApplied);
  const stale = w.only();
  assert.equal(stale.status, STATUS.notApplied);
  assert.match(stale.failure, /^Утверждение устарело: /);
  assert.equal(w.execCalls.length, 0);
  assert.equal(w.backups.length, 0);
  assert.equal(w.rows[AL].length, 1);
  assert.deepEqual(w.notes.at(-1), { event: "result", number: 1, status: STATUS.notApplied, to: null });
  // и через три дня его не подберёт ни один тик
  w.pass(3 * 24 * 60);
  assert.equal(await w.worker.tick(), null);
  assert.equal(w.execCalls.length, 0);
});

test("отказ в приёме: запрос не создан, никто не уведомлён", async () => {
  const w = world();
  const result = await w.tools.propose({ ...INPUT, commands: [{ path: "/user", action: "add", params: { name: "x" } }] }, CALLER);
  assert.equal(result.isError, true);
  assert.equal(w.docs.size, 0);
  assert.deepEqual(w.notes, []);
});
