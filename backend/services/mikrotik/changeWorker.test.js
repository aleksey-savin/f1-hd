// node --test services/mikrotik/changeWorker.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createChangeWorker } = require("./changeWorker");
const { redactedBefore } = require("./changeMatch");
const { PLACEHOLDERS } = require("./changeRules");
const { FAILURES } = require("./changeExecutor");

const NOW = new Date("2026-10-10T10:00:00Z");
const HOUR = 3600 * 1000;
const clone = (v) => structuredClone(v);

// Ошибки чтения, как их отдаёт liveReadMenus: код и признак «может пройти»
const TIMEOUT_ERR = { message: "the device did not answer in time", transient: true };
const UPGRADING_ERR = { message: "the device is being upgraded right now — try again in a few minutes", code: "MIKROTIK_LIVE_UPGRADING" };
const BUSY_ERR = { message: "too many device sessions are in progress — try again in a minute", code: "MIKROTIK_LIVE_BUSY" };
const AUTH_ERR = { message: "cannot log in: wrong password", transient: false };

const AL = "/ip firewall address-list";
const PEERS = "/interface wireguard peers";
const WG = "/interface wireguard";

const rowA = { ".id": "*A", list: "vpn", address: "10.0.0.5", disabled: "false", comment: "old" };
const rowB = { ".id": "*B", list: "vpn", address: "10.0.0.6", disabled: "false" };

const addCmd = (address = "10.0.0.9") => ({ path: AL, action: "add", params: { list: "vpn", address }, text: `add ${address}`, result: { state: "pending" } });
const setCmd = () => ({ path: AL, action: "set", where: { address: "10.0.0.5" }, params: { comment: "new" }, before: redactedBefore(AL, rowA), text: "set A", result: { state: "pending" } });
const removeCmd = () => ({ path: AL, action: "remove", where: { address: "10.0.0.6" }, before: redactedBefore(AL, rowB), text: "remove B", result: { state: "pending" } });

const makeChange = (over = {}) => ({
  _id: "c1",
  number: 5,
  mikrotik: "d1",
  status: "queued",
  createdAt: new Date("2026-10-10T09:00:00Z"),
  expiresAt: new Date(NOW.getTime() + 20 * HOUR),
  steps: [
    { role: "requester", user: "u1", decision: "approve" },
    { role: "responsible", user: "u2", decision: "approve" },
  ],
  commands: [setCmd(), addCmd()],
  timeline: [],
  ...over,
});

function setup({ changes = [makeChange()], devices, mode = "safe-mode" } = {}) {
  const h = {
    docs: new Map(changes.map((c) => [c._id, clone(c)])),
    rows: { [AL]: [clone(rowA), clone(rowB)], [PEERS]: [], [WG]: [{ ".id": "*W", name: "wg1", "public-key": "SERVERPUB", "listen-port": "13456", "private-key": "SERVERPRIV" }] },
    devices: devices || { d1: { record: { _id: "d1", credentials: { host: "1.2.3.4" } }, jump: null } },
    order: [],
    reads: [],
    backups: [],
    execCalls: [],
    notes: { result: [], expired: [], reminder: [] },
    logs: [],
    keyGen: 0,
    pskGen: 0,
    clock: NOW,
    readError: null,
    readHook: null,
    backupError: null,
    updateHook: null,
    // что вернёт исполнитель; по умолчанию — всё применено и добавлена строка
    exec: null,
    gate: null,
  };
  const store = {
    listQueued: async () => [...h.docs.values()].filter((d) => d.status === "queued").sort((a, b) => a.createdAt - b.createdAt).map(clone),
    finishedSince: async (deviceId, since, exceptId) =>
      [...h.docs.values()].some((d) => d.mikrotik === deviceId && d._id !== exceptId && ["applied", "rolled_back", "needs_attention"].includes(d.status) && d.updatedAt > since),
    ensureQueuedSince: async (id, at) => {
      const d = h.docs.get(id);
      if (!d.queuedSince) d.queuedSince = at;
      return d.queuedSince;
    },
    loadDevice: async (id) => h.devices[id] || null,
    hasApplying: async (deviceId) => [...h.docs.values()].some((d) => d.mikrotik === deviceId && d.status === "applying"),
    claim: async (id, at) => {
      const d = h.docs.get(id);
      if (!d || d.status !== "queued") return null;
      d.status = "applying";
      d.applyingSince = at;
      return clone(d);
    },
    update: async (id, { from, set = {}, unset = [], timeline = [] }) => {
      if (h.updateHook) h.updateHook({ id, from, set });
      const d = h.docs.get(id);
      if (!d || d.status !== from) return null;
      for (const [path, value] of Object.entries(set)) {
        const keys = path.split(".");
        let cur = d;
        keys.slice(0, -1).forEach((k) => {
          cur[k] = cur[k] ?? {};
          cur = cur[k];
        });
        cur[keys.at(-1)] = clone(value);
      }
      for (const path of unset) {
        const keys = path.split(".");
        let cur = d;
        keys.slice(0, -1).forEach((k) => { cur = cur?.[k]; });
        if (cur) delete cur[keys.at(-1)];
      }
      d.timeline.push(...timeline.map(clone));
      return clone(d);
    },
    findStale: async (before) => [...h.docs.values()].filter((d) => d.status === "applying" && d.applyingSince <= before).map(clone),
    findExpired: async (at) => [...h.docs.values()].filter((d) => /^awaiting/.test(d.status) && d.expiresAt <= at).map(clone),
    findDueReminders: async (at, until) =>
      [...h.docs.values()].filter((d) => /^awaiting/.test(d.status) && !d.remindedAt && d.expiresAt > at && d.expiresAt <= until).map(clone),
    markReminded: async (id, at, entry) => {
      const d = h.docs.get(id);
      if (!d || d.remindedAt || !/^awaiting/.test(d.status)) return null;
      d.remindedAt = at;
      d.timeline.push(clone(entry));
      return clone(d);
    },
    purgeKeys: async (at) => {
      let n = 0;
      for (const d of h.docs.values()) {
        if (d.wireguard?.keysExpireAt && d.wireguard.keysExpireAt <= at && (d.wireguard.privateKey || d.wireguard.presharedKey)) {
          delete d.wireguard.privateKey;
          delete d.wireguard.presharedKey;
          n += 1;
        }
      }
      return n;
    },
  };
  const readMenus = async (deviceId, paths) => {
    h.reads.push([...paths]);
    if (h.readHook) await h.readHook(h.reads.length);
    const failure = typeof h.readError === "function" ? h.readError(deviceId, h.reads.length) : h.readError;
    if (failure) throw typeof failure === "string" ? new Error(failure) : Object.assign(new Error(failure.message), failure);
    return new Map(paths.map((p) => [p, h.rows[p] ? { rows: clone(h.rows[p]) } : { error: "no such command prefix", menu: true }]));
  };
  const defaultExec = (record, items) => {
    h.rows[AL].push({ ".id": "*N1", list: "vpn", address: "10.0.0.9", disabled: "false" });
    h.rows[AL].find((r) => r[".id"] === "*A").comment = "new";
    return { executor: mode, results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: null, releaseConfirmed: true };
  };
  const executor = {
    applyCommands: async (record, items) => {
      h.order.push("executor");
      h.execCalls.push({ record, items: clone(items) });
      if (h.gate) await h.gate;
      return (h.exec || defaultExec)(record, items);
    },
  };
  const backup = async (record, opts) => {
    h.order.push("backup");
    h.backups.push({ record, opts });
    if (h.backupError) throw new Error(h.backupError);
    return { _id: "art1" };
  };
  const notifier = {
    result: async (c) => { h.notes.result.push(clone(c)); },
    expired: async (c) => { h.notes.expired.push(clone(c)); },
    reminder: async (c) => { h.notes.reminder.push(clone(c)); },
    step: async () => { throw new Error("step must not be called"); },
  };
  const keys = {
    generateKeyPair: () => {
      h.keyGen += 1;
      return { privateKey: `PRIV${h.keyGen}`, publicKey: `PUB${h.keyGen}` };
    },
    generatePresharedKey: () => {
      h.pskGen += 1;
      return h.psk || `PSK${h.pskGen}`;
    },
    encrypt: (s) => `enc(${s})`,
  };
  const log = { log: (level, message, meta) => h.logs.push(JSON.stringify([level, message, meta])) };
  const make = () => createChangeWorker({ store, readMenus, executor, backup, notifier, keys, now: () => h.clock, log, sleep: async () => {} });
  h.storeRef = store;
  h.worker = make();
  h.make = make;
  h.doc = (id = "c1") => h.docs.get(id);
  return h;
}

const wgChange = (over = {}) =>
  makeChange({
    commands: [
      {
        path: PEERS,
        action: "add",
        params: { interface: "wg1", "public-key": PLACEHOLDERS.publicKey, "preshared-key": PLACEHOLDERS.presharedKey, "allowed-address": "10.0.55.20/32" },
        text: "add peer",
        result: { state: "pending" },
      },
    ],
    wireguard: { client: { interface: "wg1", address: "10.0.55.20/32", allowedIps: ["10.0.20.0/24"], dns: [] } },
    ...over,
  });

// Исполнитель, который «создаёт» пир по настоящему публичному ключу
const peerExec = (h) => (record, items) => {
  const word = items[0].words.find((w) => w.startsWith("=public-key="));
  h.rows[PEERS].push({ ".id": "*P1", interface: "wg1", "public-key": word.slice("=public-key=".length), "allowed-address": "10.0.55.20/32" });
  return { executor: "safe-mode", results: [{ state: "done", error: null }], rolledBack: false, reachable: true, failure: null, releaseConfirmed: true };
};

const noSecrets = (h, secrets) => {
  const everything = JSON.stringify([h.logs, h.notes, [...h.docs.values()].map((d) => [d.commands.map((c) => c.text), d.timeline, d.failure])]);
  for (const s of secrets) assert.ok(!everything.includes(s), `secret ${s} leaked`);
};

// --- очередь и захват

test("tick без очереди ничего не делает", async () => {
  const h = setup({ changes: [] });
  assert.equal(await h.worker.tick(), null);
  assert.equal(h.execCalls.length, 0);
});

test("tick берёт самый старый queued, по одному за вызов", async () => {
  const older = makeChange({ _id: "c0", number: 4, mikrotik: "d2", createdAt: new Date("2026-10-10T08:00:00Z") });
  const h = setup({ changes: [makeChange(), older], devices: { d1: { record: { _id: "d1", credentials: { host: "h" } } }, d2: { record: { _id: "d2", credentials: { host: "h2" } } } } });
  const r = await h.worker.tick();
  assert.equal(r.changeId, "c0");
  assert.equal(h.doc("c0").status, "applied");
  assert.equal(h.doc("c1").status, "queued");
});

test("два одновременных tick: применяется один раз", async () => {
  const h = setup();
  const [a, b] = await Promise.all([h.worker.tick(), h.worker.tick()]);
  assert.equal(h.execCalls.length, 1);
  assert.equal([a, b].filter(Boolean).length, 1);
});

test("два воркера на общем хранилище: атомарный захват пропускает одного", async () => {
  const h = setup();
  const other = h.make();
  await Promise.all([h.worker.tick(), other.tick()]);
  assert.equal(h.execCalls.length, 1);
});

test("у устройства уже есть applying: запрос остаётся queued", async () => {
  const busy = makeChange({ _id: "c9", status: "applying", applyingSince: NOW });
  const h = setup({ changes: [makeChange(), busy] });
  assert.equal(await h.worker.tick(), null);
  assert.equal(h.doc("c1").status, "queued");
  assert.equal(h.execCalls.length, 0);
});

test("устройство или его транзит обновляется: запрос остаётся queued, берётся следующий", async () => {
  const upgrading = { since: NOW, jobId: "j" };
  const other = makeChange({ _id: "c2", number: 6, mikrotik: "d2", createdAt: new Date("2026-10-10T09:30:00Z") });
  const h = setup({
    changes: [makeChange(), other],
    devices: {
      d1: { record: { _id: "d1", credentials: { host: "h" }, upgrade: upgrading } },
      d2: { record: { _id: "d2", credentials: { host: "h2" }, jumpRecordId: "j1" }, jump: { _id: "j1", upgrade: upgrading } },
    },
  });
  assert.equal(await h.worker.tick(), null);
  assert.equal(h.doc("c1").status, "queued");
  assert.equal(h.doc("c2").status, "queued");
  assert.equal(h.execCalls.length, 0);
});

test("два применения через один транзит не идут одновременно", async () => {
  const second = makeChange({ _id: "c2", number: 6, mikrotik: "d2", createdAt: new Date("2026-10-10T09:30:00Z") });
  const devices = {
    d1: { record: { _id: "d1", credentials: { host: "h" }, jumpRecordId: "j1" }, jump: { _id: "j1" } },
    d2: { record: { _id: "d2", credentials: { host: "h2" }, jumpRecordId: "j1" }, jump: { _id: "j1" } },
  };
  const h = setup({ changes: [makeChange(), second], devices });
  let open;
  h.gate = new Promise((r) => { open = r; });
  const first = h.worker.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.execCalls.length, 1);
  assert.equal(await h.worker.tick(), null, "второй tick видит занятый транзит");
  assert.equal(h.doc("c2").status, "queued");
  open();
  await first;
  h.gate = null;
  h.clock = new Date(NOW.getTime() + 61000); // ожидавший запрос пробуется не чаще раза в минуту
  assert.equal((await h.worker.tick()).changeId, "c2");
});

test("устройство удалено: not_applied", async () => {
  const h = setup({ devices: {} });
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.match(h.doc().failure, /Устройство не найдено/);
  assert.equal(h.notes.result.length, 1);
});

// --- повторная сверка

const drift = async (mutate, changes, expectCommand) => {
  const h = setup(changes ? { changes } : undefined);
  mutate(h);
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.match(h.doc().failure, new RegExp(`^Конфигурация изменилась с момента запроса: команда ${expectCommand} — `));
  assert.ok(!h.doc().failure.includes("\n"));
  assert.equal(h.execCalls.length, 0);
  assert.equal(h.backups.length, 0);
  assert.equal(h.keyGen, 0);
  assert.equal(h.notes.result.length, 1);
  assert.equal(h.notes.result[0].status, "not_applied");
  assert.equal(h.doc().wireguard?.privateKey, undefined);
  return h;
};

test("сверка: строка set исчезла", async () => {
  const h = await drift((x) => { x.rows[AL] = [clone(rowB)]; }, null, 1);
  assert.match(h.doc().failure, /не найдена/);
});

test("сверка: под where подошли две строки", async () => {
  const h = await drift((x) => { x.rows[AL].push({ ".id": "*Z", list: "x", address: "10.0.0.5", disabled: "false" }); }, null, 1);
  assert.match(h.doc().failure, /несколько строк/);
});

test("сверка: поле из params уже другое", async () => {
  const h = await drift((x) => { x.rows[AL][0].comment = "кто-то поправил"; }, null, 1);
  assert.match(h.doc().failure, /comment/);
});

test("сверка: remove — строка изменилась целиком (любое поле)", async () => {
  const h = await drift((x) => { x.rows[AL][1].list = "other"; }, [makeChange({ commands: [addCmd(), removeCmd()] })], 2);
  assert.match(h.doc().failure, /list/);
});

test("сверка: enable/disable сверяются по всей строке", async () => {
  const cmd = { path: AL, action: "disable", where: { address: "10.0.0.6" }, before: redactedBefore(AL, rowB), text: "disable", result: { state: "pending" } };
  await drift((x) => { x.rows[AL][1].disabled = "true"; }, [makeChange({ commands: [cmd] })], 1);
});

// Финальная волна (B1) отменила прежнее правило «set сверяет только свои поля»: чужое поле настройки — дрейф
test("сверка: set — появилось поле настройки вне params — дрейф", async () => {
  const h = await drift((x) => { x.rows[AL][0].extra = "1"; }, null, 1);
  assert.match(h.doc().failure, /строка изменилась \(поле extra\)/);
});

test("сверка: true/false и yes/no равны", async () => {
  const cmd = { path: AL, action: "enable", where: { address: "10.0.0.6" }, before: { ...redactedBefore(AL, rowB), disabled: "false" }, text: "enable", result: { state: "pending" } };
  const h = setup({ changes: [makeChange({ commands: [cmd] })] });
  h.rows[AL][1].disabled = "no";
  assert.equal((await h.worker.tick()).status, "applied");
});

test("сверка: раздел не читается", async () => {
  const h = setup();
  delete h.rows[AL];
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.match(h.doc().failure, /^Конфигурация изменилась с момента запроса: команда 1 — /);
});

test("чтение: устройство обновляется или перегружено — остаётся queued, без записи ошибки", async () => {
  for (const text of [UPGRADING_ERR, BUSY_ERR, TIMEOUT_ERR]) {
    const h = setup();
    h.readError = text;
    assert.equal(await h.worker.tick(), null);
    assert.equal(h.doc().status, "queued");
    assert.equal(h.doc().failure, undefined);
    assert.equal(h.notes.result.length, 0);
  }
});

// --- бэкап и успех

test("бэкап бросил: not_applied, исполнитель не вызван, ключи выброшены", async () => {
  const h = setup({ changes: [wgChange()] });
  h.backupError = "disk full";
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().failure, "Не удалось снять резервную копию: disk full");
  assert.equal(h.execCalls.length, 0);
  assert.equal(h.doc().wireguard?.privateKey, undefined);
  assert.equal(h.doc().wireguard?.publicKey, undefined);
  assert.equal(h.notes.result.length, 1);
  noSecrets(h, ["PRIV1", "PSK1"]);
});

test("успех: бэкап до исполнителя, userId последнего утвердившего, одна сверка, слова API", async () => {
  const h = setup();
  const r = await h.worker.tick();
  assert.equal(r.status, "applied");
  assert.deepEqual(h.order, ["backup", "executor"]);
  assert.deepEqual(h.backups[0].opts, { trigger: "pre-change", userId: "u2" });
  assert.equal(h.reads.length, 1, "одна сверка, проверка после не нужна: выход подтверждён");
  assert.deepEqual(h.execCalls[0].items.map((i) => i.words), [
    ["/ip/firewall/address-list/set", "=.id=*A", "=comment=new"],
    ["/ip/firewall/address-list/add", "=list=vpn", "=address=10.0.0.9"],
  ]);
  const d = h.doc();
  assert.equal(d.backupArtifact, "art1");
  assert.equal(d.executor, "safe-mode");
  assert.deepEqual(d.commands.map((c) => c.result.state), ["done", "done"]);
  assert.equal(d.applyingSince, undefined);
  const texts = d.timeline.map((t) => t.text);
  assert.ok(texts.includes("Снята резервная копия"));
  assert.ok(texts.includes("Применено 2 команды, устройство отвечает"));
  assert.equal(h.notes.result.length, 1);
  assert.equal(h.notes.result[0].status, "applied");
});

test("плюрализация: 1 команда и 5 команд", async () => {
  const one = setup({ changes: [makeChange({ commands: [addCmd()] })] });
  await one.worker.tick();
  assert.ok(one.doc().timeline.some((t) => t.text === "Применена 1 команда, устройство отвечает"));
  const five = setup({ changes: [makeChange({ commands: [1, 2, 3, 4, 5].map((n) => addCmd(`10.0.1.${n}`)) })] });
  five.exec = (r, items) => {
    for (let n = 1; n <= 5; n += 1) five.rows[AL].push({ ".id": `*N${n}`, list: "vpn", address: `10.0.1.${n}` });
    return { executor: "safe-mode", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: null, releaseConfirmed: true };
  };
  await five.worker.tick();
  assert.ok(five.doc().timeline.some((t) => t.text === "Применено 5 команд, устройство отвечает"));
});

// --- WireGuard

test("wireguardClient: настоящий публичный ключ уходит исполнителю, секреты шифруются, нигде не светятся", async () => {
  const h = setup({ changes: [wgChange()] });
  h.exec = peerExec(h);
  const r = await h.worker.tick();
  assert.equal(r.status, "applied");
  assert.deepEqual(h.execCalls[0].items[0].words, [
    "/interface/wireguard/peers/add",
    "=interface=wg1",
    "=public-key=PUB1",
    "=preshared-key=PSK1",
    "=allowed-address=10.0.55.20/32",
  ]);
  const w = h.doc().wireguard;
  assert.equal(w.publicKey, "PUB1");
  assert.equal(w.privateKey, "enc(PRIV1)");
  assert.equal(w.presharedKey, "enc(PSK1)");
  assert.equal(w.serverPublicKey, "SERVERPUB");
  assert.equal(w.endpoint, "1.2.3.4:13456");
  assert.equal(new Date(w.keysExpireAt).getTime(), NOW.getTime() + 24 * HOUR);
  noSecrets(h, ["PRIV1", "PSK1", "SERVERPRIV"]);
});

test("wireguardClient.endpoint из запроса главнее адреса записи; без PSK-подстановки PSK не создаётся", async () => {
  const c = wgChange();
  c.wireguard.client.endpoint = "vpn.example.com:51820";
  delete c.commands[0].params["preshared-key"];
  const h = setup({ changes: [c] });
  h.exec = peerExec(h);
  await h.worker.tick();
  assert.equal(h.doc().wireguard.endpoint, "vpn.example.com:51820");
  assert.equal(h.pskGen, 0);
  assert.equal(h.doc().wireguard.presharedKey, undefined);
});

test("нет интерфейса WireGuard: not_applied, ключи не создавались", async () => {
  const h = setup({ changes: [wgChange()] });
  h.rows[WG] = [{ ".id": "*W", name: "other", "public-key": "X", "listen-port": "1" }];
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.match(h.doc().failure, /WireGuard/);
  assert.equal(h.keyGen, 0);
  assert.equal(h.backups.length, 0);
});

test("откат: ключи не сохраняются совсем", async () => {
  const h = setup({ changes: [wgChange()] });
  h.exec = () => ({ executor: "safe-mode", results: [{ state: "rolled_back", error: null }], rolledBack: true, reachable: false, failure: FAILURES.silent, releaseConfirmed: false });
  const r = await h.worker.tick();
  assert.equal(r.status, "rolled_back");
  const w = h.doc().wireguard || {};
  assert.equal(w.privateKey, undefined);
  assert.equal(w.presharedKey, undefined);
  assert.equal(w.publicKey, undefined);
  noSecrets(h, ["PRIV1", "PSK1"]);
});

test("текст ошибки роутера с секретом очищается", async () => {
  const h = setup({ changes: [wgChange()] });
  h.exec = (record, items) => ({
    executor: "safe-mode",
    results: [{ state: "failed", error: "invalid value PSK1 for preshared-key" }],
    rolledBack: true, reachable: true, failure: "command 1 failed: invalid value PSK1", releaseConfirmed: false,
  });
  await h.worker.tick();
  assert.equal(h.doc().commands[0].result.error, "invalid value *** for preshared-key");
  noSecrets(h, ["PSK1", "PRIV1"]);
});

// --- итоги

const failing = (extra = {}) => (h) => (record, items) => ({
  executor: "safe-mode",
  results: [{ state: "rolled_back", error: null }, { state: "failed", error: "failure: already have such entry", refused: true }],
  rolledBack: true, reachable: true, failure: "command 2 failed: already have such entry; safe mode was dropped and the router rolls the change back",
  releaseConfirmed: false,
  ...extra,
});

test("команда упала, проверка: ничего нет — rolled_back, состояния команд из исполнителя", async () => {
  const h = setup();
  h.exec = failing()(h);
  const r = await h.worker.tick();
  assert.equal(r.status, "rolled_back");
  const d = h.doc();
  assert.equal(d.failure, "Команда 2 не выполнилась, роутер откатил изменения");
  assert.deepEqual(d.commands.map((c) => c.result.state), ["rolled_back", "failed"]);
  assert.equal(d.commands[1].result.error, "failure: already have such entry");
  assert.ok(d.timeline.some((t) => t.text === "Команда 2 не выполнилась, роутер откатил изменения"));
  assert.equal(h.reads.length, 2, "после исполнителя прочитано ещё раз");
  assert.equal(h.notes.result.length, 1);
  assert.ok(!h.logs.join("").includes("PRIV"));
  assert.ok(h.logs.join("").includes("already have such entry"), "английский текст исполнителя остаётся в журнале");
});

test("устройство замолчало, проверка: ничего нет — rolled_back с русским текстом", async () => {
  const h = setup();
  h.exec = () => ({ executor: "safe-mode", results: [{ state: "rolled_back", error: null }, { state: "rolled_back", error: null }], rolledBack: true, reachable: false, failure: FAILURES.silent, releaseConfirmed: false });
  const r = await h.worker.tick();
  assert.equal(r.status, "rolled_back");
  assert.equal(h.doc().failure, "Устройство перестало отвечать после применения, роутер откатил изменения");
});

test("выход не подтверждён, проверка: всё на месте — applied с пометкой", async () => {
  const h = setup();
  h.exec = (record, items) => {
    defaultApply(h);
    return { executor: "safe-mode", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: FAILURES.releaseUnknown, releaseConfirmed: false };
  };
  const r = await h.worker.tick();
  assert.equal(r.status, "applied");
  assert.equal(h.reads.length, 2);
  assert.ok(h.doc().timeline.some((t) => /не подтвержд/.test(t.text) && /на месте/.test(t.text)));
  assert.deepEqual(h.doc().commands.map((c) => c.result.state), ["done", "done"]);
  assert.equal(h.doc().failure, undefined);
});

function defaultApply(h) {
  h.rows[AL].push({ ".id": "*N1", list: "vpn", address: "10.0.0.9", disabled: "false" });
  h.rows[AL].find((r) => r[".id"] === "*A").comment = "new";
}

test("выход не подтверждён, проверка: ничего нет — rolled_back", async () => {
  const h = setup();
  h.exec = (record, items) => ({ executor: "safe-mode", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: FAILURES.releaseUnknown, releaseConfirmed: false });
  const r = await h.worker.tick();
  assert.equal(r.status, "rolled_back");
  assert.match(h.doc().failure, /^Выход из safe mode не подтверждён; проверка показала: /);
  assert.deepEqual(h.doc().commands.map((c) => c.result.state), ["rolled_back", "rolled_back"]);
});

test("выход не подтверждён, проверка: часть есть — needs_attention, per-command по проверке", async () => {
  const h = setup();
  h.exec = (record, items) => {
    h.rows[AL].find((r) => r[".id"] === "*A").comment = "new"; // сделана только первая
    return { executor: "safe-mode", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: FAILURES.releaseUnknown, releaseConfirmed: false };
  };
  const r = await h.worker.tick();
  assert.equal(r.status, "needs_attention");
  const d = h.doc();
  assert.match(d.failure, /^Выход из safe mode не подтверждён; проверка показала: /);
  assert.deepEqual(d.commands.map((c) => c.result.state), ["done", "rolled_back"]);
  assert.equal(d.backupArtifact, "art1");
  assert.equal(h.notes.result.length, 1);
  assert.equal(h.notes.result[0].status, "needs_attention");
});

test("проверка не удалась (роутер не отвечает) — needs_attention", async () => {
  const h = setup();
  h.exec = () => ({ executor: "safe-mode", results: [{ state: "rolled_back", error: null }, { state: "rolled_back", error: null }], rolledBack: true, reachable: false, failure: FAILURES.silent, releaseConfirmed: false });
  // первая сверка до применения проходит, дальше роутер молчит
  h.readHook = async (n) => { if (n >= 2) h.readError = "the device did not answer in time"; };
  const r = await h.worker.tick();
  assert.equal(r.status, "needs_attention");
  assert.match(h.doc().failure, /проверить .* не удалось/);
  assert.equal(h.reads.length, 4, "три попытки проверки");
  assert.equal(h.doc().wireguard?.privateKey, undefined);
});

test("потерян safe mode (его взял другой админ), всё на месте — needs_attention, а не applied", async () => {
  const h = setup();
  h.exec = (record, items) => {
    defaultApply(h);
    return { executor: "safe-mode", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: FAILURES.lost, releaseConfirmed: false };
  };
  assert.equal((await h.worker.tick()).status, "needs_attention");
});

test("режим api: вторая команда упала, первая на месте — needs_attention", async () => {
  const h = setup({ mode: "api" });
  h.exec = (record, items) => {
    h.rows[AL].find((r) => r[".id"] === "*A").comment = "new";
    return { executor: "api", results: [{ state: "done", error: null }, { state: "failed", error: "failure: boom" }], rolledBack: false, reachable: true, failure: "command 2 failed: boom; earlier commands stay applied", releaseConfirmed: true };
  };
  const r = await h.worker.tick();
  assert.equal(r.status, "needs_attention");
  assert.deepEqual(h.doc().commands.map((c) => c.result.state), ["done", "failed"]);
  assert.equal(h.doc().commands[1].result.error, "failure: boom");
  assert.equal(h.doc().executor, "api");
});

test("режим api: первая команда упала, ничего нет — not_applied", async () => {
  const h = setup({ mode: "api" });
  h.exec = () => ({ executor: "api", results: [{ state: "failed", error: "failure: boom", refused: true }, { state: "skipped", error: null }], rolledBack: false, reachable: true, failure: "command 1 failed: boom; earlier commands stay applied", releaseConfirmed: true });
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().failure, "Команда 1 не выполнилась, изменения не вносились");
});

test("режим api: таймаут команды — может исполниться позже, needs_attention даже если пока пусто", async () => {
  const h = setup({ mode: "api" });
  h.exec = () => ({ executor: "api", results: [{ state: "failed", error: "timed out" }, { state: "skipped", error: null }], rolledBack: false, reachable: true, failure: "command 1 timed out; earlier commands stay applied", releaseConfirmed: true });
  assert.equal((await h.worker.tick()).status, "needs_attention");
});

test("режим api: всё выполнено и связь есть — applied без повторного чтения", async () => {
  const h = setup({ mode: "api" });
  const r = await h.worker.tick();
  assert.equal(r.status, "applied");
  assert.equal(h.reads.length, 1);
});

test("исполнитель не стартовал: safe mode занят / не удалось войти — not_applied, проверки нет", async () => {
  const cases = [
    [FAILURES.held, "Safe mode занят другим администратором — изменения не вносились"],
    [FAILURES.unconfirmed, "Не удалось войти в safe mode — изменения не вносились"],
    ["could not open a console session: boom", "Не удалось войти в safe mode — изменения не вносились"],
  ];
  for (const [failure, text] of cases) {
    const h = setup({ changes: [wgChange()] });
    h.exec = (record, items) => ({ executor: "safe-mode", results: items.map(() => ({ state: "skipped", error: null })), rolledBack: false, reachable: true, failure, releaseConfirmed: false });
    const r = await h.worker.tick();
    assert.equal(r.status, "not_applied");
    assert.equal(h.doc().failure, text);
    assert.equal(h.reads.length, 1);
    assert.equal(h.doc().wireguard?.privateKey, undefined);
    assert.deepEqual(h.doc().commands.map((c) => c.result.state), ["skipped"]);
  }
});

test("исполнитель: устройство начало обновляться — запрос возвращается в queued", async () => {
  const h = setup();
  h.exec = (record, items) => ({ executor: "safe-mode", results: items.map(() => ({ state: "skipped", error: null })), rolledBack: false, reachable: true, failure: "could not open a console session: The device is being upgraded", releaseConfirmed: false });
  assert.equal(await h.worker.tick(), null);
  const d = h.doc();
  assert.equal(d.status, "queued");
  assert.equal(d.applyingSince, undefined);
  assert.ok(d.timeline.some((t) => t.text === "Ожидание: устройство обновляется"));
  assert.equal(h.notes.result.length, 0);
});

// --- исключения

test("исключение до исполнителя: not_applied, applying не остаётся", async () => {
  const h = setup({ changes: [wgChange()] });
  h.rows[WG][0]["listen-port"] = "1";
  h.exec = peerExec(h);
  const worker = createChangeWorker({
    store: h.storeRef,
    readMenus: async () => new Map([[PEERS, { rows: [] }], [WG, { rows: clone(h.rows[WG]) }]]),
    executor: { applyCommands: async () => { throw new Error("must not run"); } },
    backup: async () => ({ _id: "art1" }),
    notifier: { result: async (c) => h.notes.result.push(clone(c)) },
    keys: { generateKeyPair: () => { throw new Error("entropy"); }, generatePresharedKey: () => "x", encrypt: (s) => s },
    now: () => NOW,
    log: { log: (...a) => h.logs.push(JSON.stringify(a)) },
    sleep: async () => {},
  });
  const r = await worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().status, "not_applied");
  assert.match(h.doc().failure, /Внутренняя ошибка/);
  assert.equal(h.notes.result.length, 1);
});

test("исполнитель бросил — needs_attention", async () => {
  const h = setup();
  h.exec = () => { throw new Error("boom"); };
  const r = await h.worker.tick();
  assert.equal(r.status, "needs_attention");
  assert.match(h.doc().failure, /состояние устройства неизвестно/);
  assert.equal(h.notes.result.length, 1);
});

test("исключение при записи итога: запрос не остаётся в applying", async () => {
  const h = setup();
  let first = true;
  h.updateHook = ({ set }) => {
    if (set.status === "applied" && first) { first = false; throw new Error("db down"); }
  };
  const r = await h.worker.tick();
  assert.equal(r.status, "needs_attention");
  assert.equal(h.doc().status, "needs_attention");
});

test("исключение при записи бэкапа в запрос (до исполнителя): not_applied", async () => {
  const h = setup();
  h.updateHook = ({ set }) => { if (set.backupArtifact) throw new Error("db down"); };
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.execCalls.length, 0);
});

// --- sweep

test("sweep: застрявший applying (>10 мин) — needs_attention, повторно не применяется", async () => {
  const stale = makeChange({ _id: "s1", status: "applying", applyingSince: new Date(NOW.getTime() - 11 * 60000) });
  const fresh = makeChange({ _id: "s2", mikrotik: "d2", status: "applying", applyingSince: new Date(NOW.getTime() - 60000) });
  const h = setup({ changes: [stale, fresh] });
  await h.worker.sweep();
  assert.equal(h.doc("s1").status, "needs_attention");
  assert.equal(h.doc("s1").failure, "Применение было прервано; состояние устройства неизвестно");
  assert.equal(h.doc("s2").status, "applying");
  assert.equal(h.notes.result.length, 1);
  assert.equal(h.execCalls.length, 0);
});

test("sweep: просроченный открытый запрос — expired и уведомление", async () => {
  const late = makeChange({ _id: "e1", status: "awaiting_responsible", expiresAt: new Date(NOW.getTime() - 1000) });
  const live = makeChange({ _id: "e2", status: "awaiting_requester", expiresAt: new Date(NOW.getTime() + 20 * HOUR) });
  const h = setup({ changes: [late, live] });
  await h.worker.sweep();
  assert.equal(h.doc("e1").status, "expired");
  assert.ok(h.doc("e1").timeline.some((t) => t.text === "Запрос истёк"));
  assert.equal(h.notes.expired.length, 1);
  assert.equal(h.doc("e2").status, "awaiting_requester");
  assert.equal(h.notes.reminder.length, 0);
});

test("sweep: напоминание за 2 часа — один раз, даже при двух одновременных sweep", async () => {
  const soon = makeChange({ _id: "r1", status: "awaiting_responsible", expiresAt: new Date(NOW.getTime() + 90 * 60000) });
  const h = setup({ changes: [soon] });
  const other = h.make();
  await Promise.all([h.worker.sweep(), other.sweep()]);
  assert.equal(h.notes.reminder.length, 1);
  assert.equal(new Date(h.doc("r1").remindedAt).getTime(), NOW.getTime());
  assert.ok(h.doc("r1").timeline.some((t) => t.text === "Напоминание отправлено"));
  await h.worker.sweep();
  assert.equal(h.notes.reminder.length, 1);
});

test("sweep: ключи с истёкшим сроком стираются", async () => {
  const done = makeChange({ _id: "k1", status: "applied", wireguard: { publicKey: "P", privateKey: "enc(a)", presharedKey: "enc(b)", keysExpireAt: new Date(NOW.getTime() - 1000) } });
  const keep = makeChange({ _id: "k2", status: "applied", wireguard: { publicKey: "P", privateKey: "enc(a)", keysExpireAt: new Date(NOW.getTime() + HOUR) } });
  const h = setup({ changes: [done, keep] });
  await h.worker.sweep();
  assert.equal(h.doc("k1").wireguard.privateKey, undefined);
  assert.equal(h.doc("k1").wireguard.presharedKey, undefined);
  assert.equal(h.doc("k1").wireguard.publicKey, "P");
  assert.equal(h.doc("k2").wireguard.privateKey, "enc(a)");
});

test("sweep: сбой одного шага не мешает остальным", async () => {
  const late = makeChange({ _id: "e1", status: "awaiting_responsible", expiresAt: new Date(NOW.getTime() - 1000) });
  const h = setup({ changes: [late] });
  h.worker = createChangeWorker({
    store: { ...h.storeRef, findStale: async () => { throw new Error("db"); } },
    readMenus: async () => new Map(), executor: {}, backup: async () => ({}), notifier: { expired: async (c) => h.notes.expired.push(c) },
    keys: {}, now: () => NOW, log: { log: (...a) => h.logs.push(a.join(" ")) }, sleep: async () => {},
  });
  await h.worker.sweep();
  assert.equal(h.doc("e1").status, "expired");
  assert.ok(h.logs.length > 0);
});

// ===== Fix round 1 =====

const PEER = { ".id": "*1A", interface: "wg1", "public-key": "AAAA", "allowed-address": "10.0.0.5/32", rx: "10", tx: "20", "last-handshake": "5m" };
const peerRemove = () => ({ path: PEERS, action: "remove", where: { "public-key": "AAAA" }, before: redactedBefore(PEERS, PEER), text: "remove peer", result: { state: "pending" } });

test("fix1: режим api, [done, failed], всё нет — needs_attention, не not_applied", async () => {
  const h = setup({ mode: "api" });
  h.exec = () => ({ executor: "api", results: [{ state: "done", error: null }, { state: "failed", error: "failure: boom" }], rolledBack: false, reachable: true, failure: "command 2 failed: boom; earlier commands stay applied", releaseConfirmed: true });
  assert.equal((await h.worker.tick()).status, "needs_attention");
});

test("fix3: пир с новым last-handshake и rx/tx — не дрейф; смена comment/allowed-address — дрейф", async () => {
  const h = setup({ changes: [makeChange({ commands: [peerRemove()] })] });
  h.rows[PEERS] = [{ ...PEER, rx: "99999", tx: "88888", "last-handshake": "2s" }];
  h.exec = () => { h.rows[PEERS] = []; return { executor: "safe-mode", results: [{ state: "done", error: null }], rolledBack: false, reachable: true, failure: null, releaseConfirmed: true }; };
  const first = await h.worker.tick();
  assert.equal(first.status, "applied", h.doc().failure);
  for (const change of [{ comment: "new" }, { "allowed-address": "10.9.9.9/32" }]) {
    const g = setup({ changes: [makeChange({ commands: [peerRemove()] })] });
    g.rows[PEERS] = [{ ...PEER, ...change }];
    assert.equal((await g.worker.tick()).status, "not_applied");
    assert.match(g.doc().failure, /^Конфигурация изменилась с момента запроса: команда 1 — /);
  }
});

test("fix3: правило firewall с новыми bytes — не дрейф", async () => {
  const rule = { ".id": "*1F", chain: "forward", action: "drop", bytes: "1", packets: "1" };
  const cmd = { path: "/ip firewall filter", action: "disable", where: { chain: "forward" }, before: redactedBefore("/ip firewall filter", rule), text: "d", result: { state: "pending" } };
  const h = setup({ changes: [makeChange({ commands: [cmd] })] });
  h.rows["/ip firewall filter"] = [{ ...rule, bytes: "777777", packets: "5000" }];
  h.exec = () => { h.rows["/ip firewall filter"][0].disabled = "true"; return { executor: "safe-mode", results: [{ state: "done", error: null }], rolledBack: false, reachable: true, failure: null, releaseConfirmed: true }; };
  assert.equal((await h.worker.tick()).status, "applied");
});

test("fix4: шифрование падает — not_applied до бэкапа и исполнителя", async () => {
  const h = setup({ changes: [wgChange()] });
  const worker = createChangeWorker({
    store: h.storeRef,
    readMenus: async (id, paths) => new Map(paths.map((p) => [p, { rows: clone(h.rows[p] || []) }])),
    executor: { applyCommands: async () => { h.order.push("executor"); throw new Error("no"); } },
    backup: async () => { h.order.push("backup"); return { _id: "a" }; },
    notifier: { result: async (c) => h.notes.result.push(clone(c)) },
    keys: { generateKeyPair: () => ({ privateKey: "PRIVX", publicKey: "PUBX" }), generatePresharedKey: () => "PSKX", encrypt: () => { throw new Error("bad key PRIVX"); } },
    now: () => NOW, log: { log: (...a) => h.logs.push(JSON.stringify(a)) }, sleep: async () => {},
  });
  const r = await worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().failure, "Не удалось зашифровать ключи: проверьте ключ шифрования на сервере");
  assert.deepEqual(h.order, []);
  noSecrets(h, ["PRIVX", "PSKX"]);
});

test("fix4: шифртекст, посчитанный до исполнителя, и попадает в запись", async () => {
  const h = setup({ changes: [wgChange()] });
  const order = [];
  const encrypt = h.storeRef; void encrypt;
  h.exec = peerExec(h);
  await h.worker.tick();
  assert.equal(h.doc().wireguard.privateKey, "enc(PRIV1)");
  void order;
});

test("fix minor: исполнитель бросил ошибку с PSK — в журнале и записи его нет", async () => {
  const h = setup({ changes: [wgChange()] });
  h.exec = () => { throw new Error("socket said PSK1 and PRIV1"); };
  const r = await h.worker.tick();
  assert.equal(r.status, "needs_attention");
  assert.ok(h.logs.join("").includes("***"));
  noSecrets(h, ["PSK1", "PRIV1"]);
});

test("fix minor: запись ссылки на бэкап не прошла (не applying) — исполнитель не вызывается", async () => {
  const h = setup();
  h.updateHook = ({ set }) => { if (set.backupArtifact) h.doc().status = "needs_attention"; };
  const r = await h.worker.tick();
  assert.equal(r, null);
  assert.equal(h.execCalls.length, 0);
  assert.equal(h.doc().status, "needs_attention");
  assert.equal(h.logs.filter((l) => l.includes("no longer applying")).length, 1);
});

test("fix minor: failed «not confirmed» ведёт себя как таймаут (api, всё нет — needs_attention)", async () => {
  const h = setup({ mode: "api" });
  h.exec = () => ({ executor: "api", results: [{ state: "failed", error: "not confirmed" }, { state: "skipped", error: null }], rolledBack: false, reachable: true, failure: "the API session ended before all commands were sent", releaseConfirmed: true });
  assert.equal((await h.worker.tick()).status, "needs_attention");
  const g = setup();
  g.exec = () => ({ executor: "safe-mode", results: [{ state: "failed", error: "not confirmed" }, { state: "skipped", error: null }], rolledBack: true, reachable: true, failure: "x", releaseConfirmed: false });
  assert.equal((await g.worker.tick()).status, "needs_attention");
});

test("fix minor: две add, подходящие под одну новую строку, не обе present", async () => {
  const c1 = { path: AL, action: "add", params: { list: "vpn" }, text: "a", result: { state: "pending" } };
  const c2 = { path: AL, action: "add", params: { list: "vpn", address: "10.0.0.9" }, text: "b", result: { state: "pending" } };
  const h = setup({ changes: [makeChange({ commands: [c1, c2] })] });
  h.exec = (r, items) => {
    h.rows[AL].push({ ".id": "*N1", list: "vpn", address: "10.0.0.9" });
    return { executor: "safe-mode", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: FAILURES.releaseUnknown, releaseConfirmed: false };
  };
  assert.equal((await h.worker.tick()).status, "needs_attention");
});

test("fix minor: wireguardClient + needs_attention / rolled_back — приписка про конфиг", async () => {
  const SUFFIX = "Конфигурация для сотрудника не сохранена; если пир остался на устройстве, удалите его и запросите заново.";
  const h = setup({ changes: [wgChange()] });
  h.exec = () => { throw new Error("boom"); };
  await h.worker.tick();
  assert.ok(h.doc().failure.endsWith(SUFFIX));
  const g = setup({ changes: [wgChange()] });
  g.exec = () => ({ executor: "safe-mode", results: [{ state: "rolled_back", error: null }], rolledBack: true, reachable: false, failure: FAILURES.silent, releaseConfirmed: false });
  await g.worker.tick();
  assert.equal(g.doc().status, "rolled_back");
  assert.ok(g.doc().failure.endsWith(SUFFIX));
  const plain = setup();
  plain.exec = () => { throw new Error("boom"); };
  await plain.worker.tick();
  assert.ok(!plain.doc().failure.includes("Конфигурация для сотрудника"));
});

// --- Important 2: очередь не голодает

const twoDevices = () => ({ d1: { record: { _id: "d1", credentials: { host: "h" } } }, d2: { record: { _id: "d2", credentials: { host: "h2" } } } });
const second = () => makeChange({ _id: "c2", number: 6, mikrotik: "d2", createdAt: new Date("2026-10-10T09:30:00Z") });

test("fix2: заблокированная голова не морит следующий запрос", async () => {
  const h = setup({ changes: [makeChange(), second()], devices: { ...twoDevices(), d1: { record: { _id: "d1", credentials: { host: "h" }, upgrade: { since: NOW, jobId: "j" } } } } });
  const r = await h.worker.tick();
  assert.equal(r.changeId, "c2");
  assert.equal(h.doc("c1").status, "queued");
});

test("fix2: чтение упало на голове — в том же tick применяется следующий, голова остаётся queued", async () => {
  const h = setup({ changes: [makeChange(), second()], devices: twoDevices() });
  h.readError = (id) => (id === "d1" ? TIMEOUT_ERR : null);
  const r = await h.worker.tick();
  assert.equal(r.changeId, "c2");
  assert.equal(h.doc("c1").status, "queued");
  assert.ok(h.doc("c1").timeline.some((t) => t.text === "Ожидание: устройство не отвечает"));
});

test("fix2: заметка об ожидании не дублируется", async () => {
  const h = setup({ devices: { d1: { record: { _id: "d1", credentials: { host: "h" }, upgrade: { since: NOW, jobId: "j" } } } } });
  await h.worker.tick();
  await h.worker.tick();
  await h.worker.tick();
  assert.equal(h.doc().timeline.filter((t) => t.text === "Ожидание: устройство обновляется").length, 1);
  const g = setup();
  g.readError = BUSY_ERR;
  await g.worker.tick();
  await g.worker.tick();
  assert.equal(g.doc().timeline.filter((t) => t.text === "Ожидание: устройство занято").length, 1);
});

test("fix2: 30 минут без возможности начать — not_applied с причиной и уведомлением", async () => {
  const h = setup();
  h.readError = TIMEOUT_ERR;
  await h.worker.tick();
  assert.equal(h.doc().status, "queued");
  assert.ok(h.doc().queuedSince);
  h.clock = new Date(NOW.getTime() + 31 * 60000);
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().failure, "Не удалось начать применение за 30 минут: устройство не отвечает");
  assert.equal(h.notes.result.length, 1);
  assert.equal(h.execCalls.length, 0);
  // и заблокированный до claim (обновление) тоже
  const g = setup({ devices: { d1: { record: { _id: "d1", credentials: { host: "h" }, upgrade: { since: new Date(NOW.getTime() + 40 * 60000), jobId: "j" } } } } });
  await g.worker.tick();
  g.clock = new Date(NOW.getTime() + 31 * 60000);
  assert.equal((await g.worker.tick()).status, "not_applied");
  assert.equal(g.doc().failure, "Не удалось начать применение за 30 минут: устройство обновляется");
});


// ===== Fix round 2 =====

const FW = "/ip firewall filter";
const fwRule = { ".id": "*1F", chain: "forward", action: "drop", "connection-bytes": "1000-2000", "connection-rate": "0-100k", bytes: "1", packets: "1" };
const fwCmd = (action) => ({ path: FW, action, where: { chain: "forward" }, before: redactedBefore(FW, fwRule), text: action, result: { state: "pending" } });

test("N1: connection-bytes/connection-rate у правила изменились — дрейф для enable и remove", async () => {
  for (const action of ["enable", "remove"]) {
    for (const field of ["connection-bytes", "connection-rate"]) {
      const h = setup({ changes: [makeChange({ commands: [fwCmd(action)] })] });
      h.rows[FW] = [{ ...fwRule, [field]: "5-9", bytes: "99999" }];
      const r = await h.worker.tick();
      assert.equal(r.status, "not_applied", `${action} ${field}`);
      assert.match(h.doc().failure, new RegExp(`поле ${field}`));
      assert.equal(h.backups.length, 0);
      assert.equal(h.execCalls.length, 0);
    }
  }
});

test("N1: dynamic у записи address-list / lease перевернулся — дрейф", async () => {
  const entry = { ".id": "*1A", list: "tmp", address: "10.1.1.1", dynamic: "true" };
  const rm = { path: AL, action: "remove", where: { address: "10.1.1.1" }, before: redactedBefore(AL, entry), text: "rm", result: { state: "pending" } };
  const h = setup({ changes: [makeChange({ commands: [rm] })] });
  h.rows[AL] = [{ ...entry, dynamic: "false" }];
  assert.equal((await h.worker.tick()).status, "not_applied");
  const LEASE = "/ip dhcp-server lease";
  const lease = { ".id": "*1B", address: "10.2.2.2", dynamic: "true", disabled: "false" };
  const g = setup({ changes: [makeChange({ commands: [{ path: LEASE, action: "disable", where: { address: "10.2.2.2" }, before: redactedBefore(LEASE, lease), text: "d", result: { state: "pending" } }] })] });
  g.rows[LEASE] = [{ ...lease, dynamic: "false" }];
  assert.equal((await g.worker.tick()).status, "not_applied");
  assert.match(g.doc().failure, /dynamic/);
});

test("N2: неверный пароль — not_applied сразу, одно чтение, причина в журнале", async () => {
  const h = setup();
  h.readError = AUTH_ERR;
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().failure, "Не удалось прочитать устройство: cannot log in: wrong password");
  assert.equal(h.reads.length, 1);
  assert.ok(h.logs.join("").includes("cannot log in: wrong password"));
  assert.equal(h.notes.result.length, 1);
  await h.worker.tick();
  assert.equal(h.reads.length, 1);
});

test("N2: таймаут — ожидание, чтение не чаще раза в минуту, причина в журнале", async () => {
  const h = setup();
  h.readError = TIMEOUT_ERR;
  await h.worker.tick();
  await h.worker.tick();
  await h.worker.tick();
  assert.equal(h.reads.length, 1);
  assert.equal(h.doc().status, "queued");
  assert.ok(h.logs.join("").includes("the device did not answer in time"));
  h.clock = new Date(NOW.getTime() + 61000);
  await h.worker.tick();
  assert.equal(h.reads.length, 2);
});

test("N2: ошибка без кода и без признака transient — не ожидание", async () => {
  const h = setup();
  h.readError = "something unknown";
  assert.equal((await h.worker.tick()).status, "not_applied");
});

const transportFail = (mode, results, rolledBack) => (record, items) => ({
  executor: mode, results, rolledBack, reachable: true, failure: "x", releaseConfirmed: mode === "api",
});

test("N3: api [failed без refused] всё нет — needs_attention", async () => {
  const h = setup({ mode: "api" });
  h.exec = transportFail("api", [{ state: "failed", error: "Socket timeout" }, { state: "skipped", error: null }], false);
  assert.equal((await h.worker.tick()).status, "needs_attention");
});

test("N3: safe mode [failed без refused] всё нет — needs_attention", async () => {
  const h = setup();
  h.exec = transportFail("safe-mode", [{ state: "failed", error: "Socket timeout" }, { state: "skipped", error: null }], true);
  assert.equal((await h.worker.tick()).status, "needs_attention");
});

test("N3: api [failed refused] всё нет — not_applied", async () => {
  const h = setup({ mode: "api" });
  h.exec = transportFail("api", [{ state: "failed", error: "failure: x", refused: true }, { state: "skipped", error: null }], false);
  assert.equal((await h.worker.tick()).status, "not_applied");
});

test("N3: safe mode [done, failed refused] всё нет — rolled_back", async () => {
  const h = setup();
  h.exec = transportFail("safe-mode", [{ state: "done", error: null }, { state: "failed", error: "failure: x", refused: true }], true);
  assert.equal((await h.worker.tick()).status, "rolled_back");
});

test("N4: сбой записи not_applied при сдаче без захвата — запрос остаётся queued", async () => {
  const h = setup({ devices: { d1: { record: { _id: "d1", credentials: { host: "h" }, upgrade: { since: new Date(NOW.getTime() + 40 * 60000), jobId: "j" } } } } });
  await h.worker.tick();
  h.clock = new Date(NOW.getTime() + 31 * 60000);
  h.updateHook = ({ set }) => { if (set.status === "not_applied") throw new Error("db down"); };
  assert.equal(await h.worker.tick(), null);
  assert.equal(h.doc().status, "queued");
  h.updateHook = null;
  h.clock = new Date(NOW.getTime() + 33 * 60000);
  assert.equal((await h.worker.tick()).status, "not_applied");
  assert.ok(!h.docs.get("c1").applyingSince);
});

test("N5: бэкап один раз, даже если исполнитель дважды отказал «обновляется»", async () => {
  const h = setup();
  let n = 0;
  h.exec = (record, items) => {
    n += 1;
    if (n <= 2) return { executor: "safe-mode", results: items.map(() => ({ state: "skipped", error: null })), rolledBack: false, reachable: true, failure: "could not open a console session: The device is being upgraded", releaseConfirmed: false };
    defaultApply(h);
    return { executor: "safe-mode", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: null, releaseConfirmed: true };
  };
  await h.worker.tick();
  h.clock = new Date(NOW.getTime() + 61000);
  await h.worker.tick();
  h.clock = new Date(NOW.getTime() + 122000);
  assert.equal((await h.worker.tick()).status, "applied");
  assert.equal(h.backups.length, 1);
  assert.equal(h.doc().timeline.filter((t) => t.text === "Снята резервная копия").length, 1);
});

test("запрос без команд: not_applied, исполнитель не вызван", async () => {
  const h = setup({ changes: [makeChange({ commands: [] })] });
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().failure, "В запросе нет команд");
  assert.equal(h.execCalls.length, 0);
  assert.equal(h.backups.length, 0);
});

test("текст ошибки роутера, обрезанный посреди PSK, не оставляет префикс ключа", async () => {
  const h = setup({ changes: [wgChange()] });
  h.psk = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg=";
  h.exec = () => ({
    executor: "safe-mode",
    results: [{ state: "failed", error: `invalid value ${h.psk.slice(0, 20)}`, refused: true }],
    rolledBack: true, reachable: true, failure: "x", releaseConfirmed: false,
  });
  await h.worker.tick();
  assert.ok(!JSON.stringify(h.docs.get("c1")).includes(h.psk.slice(0, 12)));
  assert.ok(!h.logs.join("").includes(h.psk.slice(0, 12)));
  assert.equal(h.doc().commands[0].result.error, "invalid value ***");
});


// ===== Fix round 3 =====

test("R3: timeout записи address-list: убыл — не дрейф, вырос до 30d — дрейф", async () => {
  const entry = { ".id": "*1A", list: "tmp", address: "10.1.1.1", timeout: "1h" };
  const rm = () => ({ path: AL, action: "remove", where: { address: "10.1.1.1" }, before: redactedBefore(AL, entry), text: "rm", result: { state: "pending" } });
  const ok = setup({ changes: [makeChange({ commands: [rm()] })] });
  ok.rows[AL] = [{ ...entry, timeout: "59m50s" }];
  ok.exec = () => { ok.rows[AL] = []; return { executor: "safe-mode", results: [{ state: "done", error: null }], rolledBack: false, reachable: true, failure: null, releaseConfirmed: true }; };
  assert.equal((await ok.worker.tick()).status, "applied");
  const bad = setup({ changes: [makeChange({ commands: [rm()] })] });
  bad.rows[AL] = [{ ...entry, timeout: "30d" }];
  assert.equal((await bad.worker.tick()).status, "not_applied");
  assert.match(bad.doc().failure, /поле timeout/);
});

const removeApplies = (h, path) => () => {
  h.rows[path] = [];
  return { executor: "safe-mode", results: [{ state: "done", error: null }], rolledBack: false, reachable: true, failure: null, releaseConfirmed: true };
};
const driftCase = async (path, stored, fresh, action = "remove", where) => {
  const cmd = { path, action, where, before: redactedBefore(path, stored), text: action, result: { state: "pending" } };
  const h = setup({ changes: [makeChange({ commands: [cmd] })] });
  h.rows[path] = [fresh];
  h.exec = removeApplies(h, path);
  return h;
};

test("R3: lease ушёл офлайн (active-* пропали) — не дрейф", async () => {
  const LEASE = "/ip dhcp-server lease";
  const stored = { ".id": "*1B", address: "10.2.2.2", "mac-address": "AA:BB", "active-address": "10.2.2.2", "active-mac-address": "AA:BB", "host-name": "pc", "class-id": "MSFT", "active-server": "dhcp1", disabled: "false" };
  const { disabled, address } = stored;
  const h = await driftCase(LEASE, stored, { ".id": "*1B", address, "mac-address": "AA:BB", disabled }, "remove", { address });
  assert.equal((await h.worker.tick()).status, "applied");
});

test("R3: очередь с новыми rate/queued-bytes — не дрейф", async () => {
  const Q = "/queue simple";
  const stored = { ".id": "*1C", name: "q1", target: "10.0.0.0/24", "max-limit": "10M/10M", rate: "0/0", "queued-bytes": "0", "total-dropped": "0" };
  const h = await driftCase(Q, stored, { ...stored, rate: "5M/1M", "queued-bytes": "9000", "total-dropped": "12" }, "remove", { name: "q1" });
  assert.equal((await h.worker.tick()).status, "applied");
});

test("R3: маршрут с другим immediate-gw — не дрейф; другой distance/gateway — дрейф", async () => {
  const R = "/ip route";
  const stored = { ".id": "*1D", "dst-address": "0.0.0.0/0", gateway: "1.1.1.1", distance: "1", "immediate-gw": "ether1", "gateway-status": "reachable" };
  const where = { "dst-address": "0.0.0.0/0" };
  const same = await driftCase(R, stored, { ...stored, "immediate-gw": "ether2", "gateway-status": "unreachable" }, "remove", where);
  assert.equal((await same.worker.tick()).status, "applied");
  for (const change of [{ distance: "5" }, { gateway: "9.9.9.9" }]) {
    const h = await driftCase(R, stored, { ...stored, ...change }, "remove", where);
    assert.equal((await h.worker.tick()).status, "not_applied");
  }
});

test("R3: заблокированный адрес не ждёт, даже если classifier назвал ошибку transient", async () => {
  const h = setup();
  h.readError = { message: "address of timeout.example.com is not allowed", code: "MIKROTIK_BLOCKED_HOST", transient: true };
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.match(h.doc().failure, /^Не удалось прочитать устройство: /);
  assert.equal(h.reads.length, 1);
});

const upgradeRefusal = (items) => ({ executor: "safe-mode", results: items.map(() => ({ state: "skipped", error: null })), rolledBack: false, reachable: true, failure: "could not open a console session: The device is being upgraded", releaseConfirmed: false });

test("R3: бэкап старше 10 минут снимается заново, заметка пишется снова", async () => {
  const h = setup();
  let n = 0;
  h.exec = (r, items) => { n += 1; if (n === 1) return upgradeRefusal(items); defaultApply(h); return { executor: "safe-mode", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: null, releaseConfirmed: true }; };
  await h.worker.tick();
  h.clock = new Date(NOW.getTime() + 11 * 60000);
  assert.equal((await h.worker.tick()).status, "applied");
  assert.equal(h.backups.length, 2);
  assert.equal(h.doc().timeline.filter((t) => t.text === "Снята резервная копия").length, 2);
});

test("R3: пока ждали, другой запрос на устройстве дошёл до итога — бэкап снимается заново", async () => {
  const h = setup({ changes: [makeChange(), makeChange({ _id: "c2", number: 6, status: "queued", createdAt: new Date("2026-10-10T09:59:00Z") })] });
  h.docs.get("c2").status = "applied"; // не в очереди
  let n = 0;
  h.exec = (r, items) => { n += 1; if (n === 1) return upgradeRefusal(items); defaultApply(h); return { executor: "safe-mode", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: null, releaseConfirmed: true }; };
  await h.worker.tick();
  h.docs.get("c2").updatedAt = new Date(NOW.getTime() + 30000);
  h.clock = new Date(NOW.getTime() + 61000);
  assert.equal((await h.worker.tick()).status, "applied");
  assert.equal(h.backups.length, 2);
});

test("R3: дрейф на второй попытке не приписывает этой попытке бэкап", async () => {
  const h = setup();
  let n = 0;
  h.exec = (r, items) => { n += 1; return upgradeRefusal(items); };
  await h.worker.tick();
  h.rows[AL][0].comment = "кто-то поправил";
  h.clock = new Date(NOW.getTime() + 61000);
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.backups.length, 1);
  assert.equal(h.doc().timeline.filter((t) => t.text === "Снята резервная копия").length, 1);
  assert.match(h.doc().failure, /^Конфигурация изменилась/);
  assert.equal(h.doc().timeline.filter((t) => t.kind === "backup").length, 1);
});

test("R3: api, executor done, проверка не видит — failed «не найдена при проверке», не rolled_back", async () => {
  const h = setup({ mode: "api" });
  h.exec = (record, items) => {
    h.rows[AL].find((r) => r[".id"] === "*A").comment = "new"; // сделана только первая
    return { executor: "api", results: items.map(() => ({ state: "done", error: null })), rolledBack: false, reachable: false, failure: null, releaseConfirmed: true };
  };
  const r = await h.worker.tick();
  assert.equal(r.status, "needs_attention");
  assert.deepEqual(h.doc().commands.map((c) => c.result.state), ["done", "failed"]);
  assert.equal(h.doc().commands[1].result.error, "не найдена при проверке");
});


// ===== Fix round 4: бегущие поля — по разделам =====

const r4Refused = async (path, stored, fresh, action, where, field) => {
  const h = await driftCase(path, stored, fresh, action, where);
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied", `${path} ${action} ${field}`);
  assert.match(h.doc().failure, new RegExp(`строка изменилась \\(поле ${field}\\)`));
  assert.equal(h.execCalls.length, 0);
  assert.equal(h.backups.length, 0);
};

test("R4: rate в /interface ethernet switch … изменился — дрейф для remove/disable/enable", async () => {
  for (const path of ["/interface ethernet switch rule", "/interface ethernet switch ingress-port-policer", "/interface ethernet switch shaper"]) {
    const stored = { ".id": "*1", switch: "switch1", ports: "ether2", rate: "10M", disabled: "false" };
    for (const action of ["remove", "disable", "enable"]) await r4Refused(path, stored, { ...stored, rate: "1G" }, action, { ports: "ether2" }, "rate");
  }
});

test("R4: host-name в /ip dhcp-client изменился — дрейф", async () => {
  const stored = { ".id": "*1", interface: "ether1", "host-name": "router", disabled: "false" };
  for (const action of ["remove", "disable"]) await r4Refused("/ip dhcp-client", stored, { ...stored, "host-name": "other" }, action, { interface: "ether1" }, "host-name");
});

test("R4: раздел вне карты — статистика считается изменением (безопасный отказ)", async () => {
  const stored = { ".id": "*1", name: "x", bytes: "1", disabled: "false" };
  await r4Refused("/some new menu", stored, { ...stored, bytes: "2" }, "remove", { name: "x" }, "bytes");
  await r4Refused("/queue type", { ".id": "*1", name: "x", rate: "1" }, { ".id": "*1", name: "x", rate: "2" }, "remove", { name: "x" }, "rate");
});

test("R4: timeout вне address-list сверяется точно; у lease host-name по-прежнему не дрейф", async () => {
  const stored = { ".id": "*1", name: "x", timeout: "1h" };
  await r4Refused("/ip firewall filter", { ...stored, chain: "forward" }, { ...stored, chain: "forward", timeout: "59m" }, "remove", { name: "x" }, "timeout");
  const lease = { ".id": "*2", address: "10.2.2.2", "mac-address": "AA:BB", "host-name": "pc", status: "bound", "expires-after": "9m", "last-seen": "1m" };
  const h = await driftCase("/ip dhcp-server lease", lease, { ...lease, "host-name": "pc2", status: "waiting", "expires-after": "1m", "last-seen": "9m" }, "remove", { address: "10.2.2.2" });
  assert.equal((await h.worker.tick()).status, "applied", h.doc().failure);
});

test("R4: счётчики интерфейса и очереди не мешают disable, настройка — мешает", async () => {
  const iface = { ".id": "*3", name: "vlan10", type: "vlan", mtu: "1500", "rx-byte": "1", "tx-byte": "1", "link-downs": "0", running: "true", "last-link-up-time": "a", disabled: "false" };
  const h = await driftCase("/interface", iface, { ...iface, "rx-byte": "999", "tx-byte": "999", "link-downs": "3", running: "false", "last-link-up-time": "b" }, "disable", { name: "vlan10" });
  h.exec = () => { h.rows["/interface"][0].disabled = "true"; return { executor: "safe-mode", results: [{ state: "done", error: null }], rolledBack: false, reachable: true, failure: null, releaseConfirmed: true }; };
  assert.equal((await h.worker.tick()).status, "applied", h.doc().failure);
  await r4Refused("/interface", iface, { ...iface, mtu: "9000", "rx-byte": "5" }, "disable", { name: "vlan10" }, "mtu");
  const q = { ".id": "*4", name: "q1", target: "10.0.0.0/24", "max-limit": "10M/10M", rate: "0/0" };
  await r4Refused("/queue simple", q, { ...q, "max-limit": "1M/1M", rate: "5/5" }, "remove", { name: "q1" }, "max-limit");
});

// Финальная волна (B1): set сверяет и остальную строку; раздел вне карты бегущих полей — любое отличие отказ
test("R4: set — чужое поле в разделе вне карты изменилось — дрейф (прежде проходило)", async () => {
  const path = "/ip dhcp-client";
  const row = { ".id": "*5", interface: "ether1", "host-name": "router", comment: "old", disabled: "false" };
  const cmd = { path, action: "set", where: { interface: "ether1" }, params: { comment: "new" }, before: redactedBefore(path, row), text: "set", result: { state: "pending" } };
  const h = setup({ changes: [makeChange({ commands: [cmd] })] });
  h.rows[path] = [{ ...row, "host-name": "other" }];
  assert.equal((await h.worker.tick()).status, "not_applied");
  assert.match(h.doc().failure, /строка изменилась \(поле host-name\)/);
  assert.equal(h.execCalls.length, 0);
});

// ===== Финальная волна =====

const OK_RUN = (n = 1) => ({ executor: "safe-mode", results: Array.from({ length: n }, () => ({ state: "done", error: null })), rolledBack: false, reachable: true, failure: null, releaseConfirmed: true });

// --- B1: set попадает в другую строку, чем видели люди

test("B1: под тем же where теперь другая строка (другой .id) — not_applied, ничего не отправлено", async () => {
  const seen = { ".id": "*A", chain: "forward", action: "accept", comment: "tmp", disabled: "false" };
  const live = { ".id": "*F", chain: "input", action: "drop", comment: "tmp", disabled: "false" };
  const cmd = { path: FW, action: "set", where: { comment: "tmp" }, params: { disabled: "yes" }, before: redactedBefore(FW, seen), rowId: "*A", text: "set", result: { state: "pending" } };
  const h = setup({ changes: [makeChange({ commands: [cmd] })] });
  h.rows[FW] = [live];
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().failure, "Команда 1: строка заменена другой с момента запроса");
  assert.equal(h.execCalls.length, 0);
  assert.equal(h.backups.length, 0);
  assert.equal(h.notes.result.length, 1);
});

test("B1: другой .id — отказ для remove, enable и disable тоже, даже если строка выглядит так же", async () => {
  for (const action of ["remove", "enable", "disable"]) {
    const row = { ".id": "*A", chain: "forward", action: "accept", comment: "tmp", disabled: action === "enable" ? "true" : "false" };
    const cmd = { path: FW, action, where: { comment: "tmp" }, before: redactedBefore(FW, row), rowId: "*A", text: action, result: { state: "pending" } };
    const h = setup({ changes: [makeChange({ commands: [cmd] })] });
    h.rows[FW] = [{ ...row, ".id": "*F" }];
    assert.equal((await h.worker.tick()).status, "not_applied", action);
    assert.equal(h.doc().failure, "Команда 1: строка заменена другой с момента запроса");
    assert.equal(h.execCalls.length, 0);
  }
});

test("B1: set — изменилось поле настройки, которое команда не трогает — дрейф", async () => {
  const row = { ".id": "*A", chain: "forward", action: "accept", comment: "tmp", disabled: "false", bytes: "1", packets: "1" };
  const cmd = { path: FW, action: "set", where: { comment: "tmp" }, params: { disabled: "yes" }, before: redactedBefore(FW, row), rowId: "*A", text: "set", result: { state: "pending" } };
  const h = setup({ changes: [makeChange({ commands: [cmd] })] });
  h.rows[FW] = [{ ...row, chain: "input", action: "drop" }];
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.match(h.doc().failure, /^Конфигурация изменилась с момента запроса: команда 1 — строка изменилась \(поле (chain|action)\)$/);
  assert.equal(h.execCalls.length, 0);
});

test("B1: set — сдвинулись только счётчики раздела из карты бегущих полей — не дрейф", async () => {
  const row = { ".id": "*A", chain: "forward", action: "accept", comment: "tmp", disabled: "false", bytes: "1", packets: "1" };
  const cmd = { path: FW, action: "set", where: { comment: "tmp" }, params: { disabled: "yes" }, before: redactedBefore(FW, row), rowId: "*A", text: "set", result: { state: "pending" } };
  const h = setup({ changes: [makeChange({ commands: [cmd] })] });
  h.rows[FW] = [{ ...row, bytes: "999999", packets: "4242" }];
  h.exec = () => { h.rows[FW][0].disabled = "true"; return OK_RUN(1); };
  assert.equal((await h.worker.tick()).status, "applied", h.doc().failure);
  assert.deepEqual(h.execCalls[0].items[0].words, ["/ip/firewall/filter/set", "=.id=*A", "=disabled=yes"]);
});

// --- B2: утверждение устаревает

const approvedAt = (at) => [
  { role: "requester", user: "u1", decision: "approve", decidedAt: new Date(at.getTime() - 60000) },
  { role: "responsible", user: "u2", decision: "approve", decidedAt: at },
];

test("B2: утверждено три дня назад — not_applied без захвата, исполнитель и бэкап не вызваны", async () => {
  const h = setup({ changes: [makeChange({ commands: [addCmd()], steps: approvedAt(new Date(NOW.getTime() - 72 * HOUR)) })] });
  const r = await h.worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().status, "not_applied");
  assert.equal(h.doc().failure, "Утверждение устарело: с момента решения прошло больше 30 минут, изменения не вносились. Запросите заново.");
  assert.equal(h.doc().applyingSince, undefined, "запрос не захватывался");
  assert.equal(h.execCalls.length, 0);
  assert.equal(h.backups.length, 0);
  assert.equal(h.reads.length, 0);
  assert.equal(h.notes.result.length, 1);
  assert.equal(h.notes.result[0].status, "not_applied");
  assert.equal(h.doc().timeline.at(-1).kind, "result");
});

test("B2: утверждено пять минут назад — применяется; queuedSince — время последнего решения", async () => {
  const at = new Date(NOW.getTime() - 5 * 60000);
  const h = setup({ changes: [makeChange({ commands: [addCmd()], steps: approvedAt(at) })] });
  const r = await h.worker.tick();
  assert.equal(r.status, "applied", h.doc().failure);
  assert.equal(h.execCalls.length, 1);
  assert.equal(new Date(h.doc().queuedSince).getTime(), at.getTime());
});

test("B2: запись итога устаревшего запроса не прошла — он остаётся queued, ничего не применено", async () => {
  const stale = makeChange({ _id: "old", commands: [addCmd()], steps: approvedAt(new Date(NOW.getTime() - 31 * 60000)) });
  const h = setup({ changes: [stale] });
  h.storeRef.update = async () => null;
  assert.equal(await h.worker.tick(), null);
  assert.equal(h.doc("old").status, "queued");
  assert.equal(h.execCalls.length, 0);
});

// --- B5: исполнитель собирается лениво; sweep от него не зависит

const { lazyExecutor } = require("./changeWorker");

test("B5: sweep работает, даже если исполнитель собрать нельзя", async () => {
  const late = makeChange({ _id: "e1", status: "awaiting_responsible", expiresAt: new Date(NOW.getTime() - 1000) });
  const h = setup({ changes: [late] });
  let built = 0;
  const worker = createChangeWorker({
    store: h.storeRef, readMenus: async () => new Map(), backup: async () => ({}),
    executor: lazyExecutor(() => { built += 1; throw new Error("unknown executor mode: safemode"); }),
    notifier: { expired: async (c) => h.notes.expired.push(c) }, keys: {}, now: () => NOW, log: { log() {} }, sleep: async () => {},
  });
  await worker.sweep();
  assert.equal(h.doc("e1").status, "expired");
  assert.equal(h.notes.expired.length, 1);
  assert.equal(built, 0, "sweep исполнитель не трогает");
});

test("B5: исполнитель не собрался — not_applied до бэкапа, а не «состояние неизвестно»", async () => {
  const h = setup({ changes: [makeChange({ commands: [addCmd()] })] });
  const worker = createChangeWorker({
    store: h.storeRef, readMenus: async (id, paths) => new Map(paths.map((p) => [p, { rows: clone(h.rows[p] || []) }])),
    backup: async () => { h.backups.push(1); return { _id: "art1" }; },
    executor: lazyExecutor(() => { throw new Error("cannot build"); }),
    notifier: { result: async (c) => h.notes.result.push(c) }, keys: {}, now: () => NOW, log: { log() {} }, sleep: async () => {},
  });
  const r = await worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().failure, "Внутренняя ошибка: изменения не вносились");
  assert.equal(h.backups.length, 0);
});

test("B5: lazyExecutor собирает исполнитель один раз и передаёт вызов", async () => {
  let built = 0;
  const ex = lazyExecutor(() => { built += 1; return { applyCommands: async (record, items) => ({ record, n: items.length }) }; });
  assert.equal(built, 0);
  ex.prepare();
  assert.deepEqual(await ex.applyCommands("r", [1, 2]), { record: "r", n: 2 });
  await ex.applyCommands("r", []);
  assert.equal(built, 1);
});

// --- Права учётной записи на устройстве проверяются до бэкапа

const rightsWorker = (h, readRights) => createChangeWorker({
  store: h.storeRef,
  readMenus: async (id, paths) => { h.reads.push([...paths]); return new Map(paths.map((p) => [p, { rows: clone(h.rows[p] || []) }])); },
  executor: { applyCommands: async (record, items) => { h.execCalls.push({ items }); h.rows[AL].push({ ".id": "*N1", list: "vpn", address: "10.0.0.9", disabled: "false" }); return OK_RUN(items.length); } },
  backup: async () => { h.backups.push(1); return { _id: "art1" }; },
  notifier: { result: async (c) => h.notes.result.push(c) },
  keys: {}, now: () => h.clock, log: { log: (...a) => h.logs.push(JSON.stringify(a)) }, sleep: async () => {},
  readRights,
});
const account = (policy) => ({ user: "hd", users: [{ name: "hd", group: "hd-group" }], groups: [{ name: "hd-group", policy }] });

test("права: у группы учётной записи нет write — not_applied до бэкапа, политика названа", async () => {
  const h = setup({ changes: [makeChange({ commands: [addCmd()] })] });
  const seen = [];
  const r = await rightsWorker(h, async (record) => { seen.push(record._id); return account("api,read,ssh,!write,test"); }).tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().failure, "У учётной записи HD на устройстве нет политики write: изменения не вносились.");
  assert.deepEqual(seen, ["d1"]);
  assert.equal(h.backups.length, 0);
  assert.equal(h.execCalls.length, 0);
  assert.equal(h.notes.result.length, 1);
});

test("права: не хватает нескольких политик — названы все", async () => {
  const h = setup({ changes: [makeChange({ commands: [addCmd()] })] });
  await rightsWorker(h, async () => account("read,test")).tick();
  assert.equal(h.doc().failure, "У учётной записи HD на устройстве нет политик api, write, ssh: изменения не вносились.");
});

test("права: все четыре политики есть — применяется", async () => {
  const h = setup({ changes: [makeChange({ commands: [addCmd()] })] });
  const r = await rightsWorker(h, async () => account("api,read,write,ssh")).tick();
  assert.equal(r.status, "applied", h.doc().failure);
  assert.equal(h.backups.length, 1);
});

test("права: списки пользователей не читаются (нет policy) или учётки нет в списке — судить нечем, применяется", async () => {
  for (const got of [{ user: "hd", users: undefined, groups: undefined }, { user: "hd", users: [], groups: [] }, null]) {
    const h = setup({ changes: [makeChange({ commands: [addCmd()] })] });
    const r = await rightsWorker(h, async () => got).tick();
    assert.equal(r.status, "applied", h.doc().failure);
  }
});

test("права: временный сбой чтения — ожидание как у любого чтения до применения; постоянный — применяется без вердикта", async () => {
  const h = setup({ changes: [makeChange({ commands: [addCmd()] })] });
  const w = rightsWorker(h, async () => { throw Object.assign(new Error(TIMEOUT_ERR.message), TIMEOUT_ERR); });
  assert.equal(await w.tick(), null);
  assert.equal(h.doc().status, "queued");
  assert.ok(h.doc().timeline.some((t) => t.text === "Ожидание: устройство не отвечает"));
  assert.equal(h.backups.length, 0);
  assert.equal(h.execCalls.length, 0);

  const g = setup({ changes: [makeChange({ commands: [addCmd()] })] });
  const r = await rightsWorker(g, async () => { throw new Error("no such command prefix"); }).tick();
  assert.equal(r.status, "applied", g.doc().failure);
  assert.ok(g.logs.some((l) => l.includes("rights check skipped")));
});

// --- Отказ роутера хранится в результате команды

test("отказ роутера (refused) сохраняется в результате команды; таймаут — без признака", async () => {
  const h = setup({ changes: [makeChange({ commands: [addCmd("10.0.0.9"), addCmd("10.0.0.10")] })] });
  h.exec = () => ({ executor: "safe-mode", results: [{ state: "done", error: null }, { state: "failed", error: "failure: already have such entry", refused: true }], rolledBack: true, reachable: true, failure: "command 2 failed", releaseConfirmed: false });
  const r = await h.worker.tick();
  assert.equal(r.status, "rolled_back");
  assert.equal(h.doc().commands[1].result.refused, true);
  assert.equal(h.doc().commands[1].result.error, "failure: already have such entry");
  assert.equal(h.doc().commands[0].result.refused, undefined);
  assert.equal(h.notes.result[0].commands[1].result.refused, true);
});

test("B2: запрос ждал по причине и устарел — в итоге названа причина ожидания", async () => {
  const steps = approvedAt(new Date(NOW.getTime() - 31 * 60000));
  const waited = makeChange({ commands: [addCmd()], steps, timeline: [{ at: NOW, kind: "wait", text: "Ожидание: устройство обновляется" }] });
  const h = setup({ changes: [waited] });
  assert.equal((await h.worker.tick()).status, "not_applied");
  assert.equal(h.doc().failure, "Не удалось начать применение за 30 минут: устройство обновляется");
  assert.equal(h.execCalls.length, 0);
});

// --- Отложенные мелочи

test("мелочи: исполнитель ничего не отправил (все skipped, отката нет) — «Не применён», без проверки чтением и без слов об откате", async () => {
  const h = setup({ changes: [makeChange({ commands: [addCmd()] })] });
  const worker = createChangeWorker({
    store: h.storeRef,
    readMenus: async (id, paths) => { h.reads.push([...paths]); return new Map(paths.map((p) => [p, { rows: clone(h.rows[p] || []) }])); },
    executor: { applyCommands: async (record, items) => ({ executor: "safe-mode", results: items.map(() => ({ state: "skipped", error: null })), rolledBack: false, reachable: true, releaseConfirmed: false, failure: "unexpected error while applying: boom" }) },
    backup: async () => ({ _id: "art1" }),
    notifier: { result: async (c) => h.notes.result.push(c) },
    keys: {}, now: () => h.clock, log: { log: (...a) => h.logs.push(JSON.stringify(a)) }, sleep: async () => {},
  });
  const r = await worker.tick();
  assert.equal(r.status, "not_applied");
  assert.equal(h.doc().failure, "Применение не началось из-за внутренней ошибки — изменения не вносились");
  assert.ok(!/откатил/.test(h.doc().failure));
  assert.equal(h.reads.length, 1); // только сверка перед применением, проверки после — нет
});

test("мелочи: права не удалось оценить (вердикта нет) — применение идёт, в журнале одна строка об этом", async () => {
  const h = setup({ changes: [makeChange({ commands: [addCmd()] })] });
  const r = await rightsWorker(h, async () => ({ user: "hd", users: [], groups: [] })).tick();
  assert.equal(r.status, "applied");
  assert.equal(h.logs.filter((l) => /rights check gave no verdict/.test(l)).length, 1);
});
