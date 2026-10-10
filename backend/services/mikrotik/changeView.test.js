// node --test services/mikrotik/changeView.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { toView } = require("./changeView");

const NOW = new Date("2026-10-10T09:00:00Z");
const person = (id, first, last) => ({ _id: id, firstName: first, lastName: last, email: `${id}@x.ru`, phone: "+7999", telegramBot: { chatId: "123" } });

const change = (extra = {}) => ({
  _id: "c1",
  number: 7,
  title: "WireGuard для Ивана",
  reason: "Просил сотрудник",
  status: "awaiting_requester",
  risk: "normal",
  executor: "safe-mode",
  createdAt: new Date("2026-10-10T08:00:00Z"),
  expiresAt: new Date("2026-10-11T08:00:00Z"),
  mikrotik: { _id: "m1", name: "F1-GW01", label: "Шлюз" },
  requestedBy: person("req", "Иван", "Петров"),
  requestedVia: { keyId: "k", keyName: "OpenClaw" },
  responsible: person("resp", "Анна", "Смирнова"),
  steps: [
    { role: "requester", user: person("req", "Иван", "Петров"), decision: null },
    { role: "responsible", user: person("resp", "Анна", "Смирнова"), decision: null },
  ],
  commands: [
    { path: "/ip firewall address-list", action: "set", text: "/ip firewall address-list set [find where list=x] disabled=yes", risk: "normal", riskReason: "r", before: { disabled: "no" }, params: { disabled: "yes" }, where: { list: "x" }, result: { state: "pending" } },
  ],
  timeline: [{ at: NOW, kind: "decision", user: person("req", "Иван", "Петров"), text: "Утверждено" }],
  backupArtifact: { _id: "a1", createdAt: new Date("2026-10-10T08:30:00Z"), content: "SECRET" },
  telegram: [{ user: "req", chatId: "123", messageId: 5 }],
  wireguard: {
    publicKey: "PUB", privateKey: "ENC-PRIV", presharedKey: "ENC-PSK", serverPublicKey: "SRV", endpoint: "h:1",
    keysExpireAt: new Date("2026-10-11T08:00:00Z"),
    client: { interface: "wg1", address: "10.0.55.20/32", allowedIps: ["10.0.20.0/24"], dns: [], endpoint: "h:1" },
  },
  ...extra,
});

const viewer = (userId, extra = {}) => ({ userId, canApprove: false, canManageConfigs: false, ...extra });
const view = (c, v) => toView(c, v, NOW);

test("заявитель: полный вид, имена вместо людей, шаг подтверждения", () => {
  const v = view(change(), viewer("req"));
  assert.equal(v.number, 7);
  assert.equal(v.statusLabel, "Ждёт заявителя");
  assert.deepEqual(v.requestedBy, { _id: "req", name: "Иван Петров" });
  assert.deepEqual(v.responsible, { _id: "resp", name: "Анна Смирнова" });
  assert.deepEqual(v.steps[0].user, { _id: "req", name: "Иван Петров" });
  assert.equal(v.commands.length, 1);
  assert.deepEqual(v.commands[0].diff, [{ field: "disabled", from: "no", to: "yes" }]);
  assert.equal(v.reason, "Просил сотрудник");
  assert.equal(v.timeline.length, 1);
  assert.deepEqual(v.backup, { artifactId: "a1", createdAt: new Date("2026-10-10T08:30:00Z") });
  assert.deepEqual(v.device, { _id: "m1", name: "F1-GW01" });
  assert.deepEqual(v.my, { step: true, action: "confirm", canCancel: true, canDownload: false });
});

test("ответственный: действие approve только при праве; без права — null", () => {
  const c = change({ status: "awaiting_responsible", steps: [
    { role: "requester", user: "req", decision: "approve" },
    { role: "responsible", user: "resp", decision: null },
  ] });
  assert.equal(view(c, viewer("resp", { canApprove: true })).my.action, "approve");
  assert.equal(view(c, viewer("resp", { canApprove: false })).my.action, null);
  assert.equal(view(c, viewer("resp", { canApprove: true })).my.canCancel, false);
});

test("единственный шаг заявителя: approve при праве", () => {
  const c = change({ steps: [{ role: "requester", user: "req", decision: null }] });
  assert.equal(view(c, viewer("req", { canApprove: true })).my.action, "approve");
  assert.equal(view(c, viewer("req", { canApprove: false })).my.action, null);
});

test("кто видит полный вид: заявитель, ответственный, любой шаг, approveChanges, manageConfigs", () => {
  const c = change();
  for (const v of [viewer("req"), viewer("resp"), viewer("x", { canApprove: true }), viewer("y", { canManageConfigs: true })]) {
    assert.ok(Array.isArray(view(c, v).commands), JSON.stringify(v));
  }
  const withStepUser = change({ steps: [{ role: "responsible", user: "third", decision: null }], responsible: "someoneelse" });
  assert.ok(view(withStepUser, viewer("third")).commands);
});

test("посторонний с mikrotik.read: только номер, название, статус, дата, устройство", () => {
  const v = view(change(), viewer("stranger"));
  assert.deepEqual(Object.keys(v).sort(), ["_id", "createdAt", "device", "number", "status", "statusLabel", "title"]);
  assert.equal(v.status, "awaiting_requester");
  assert.deepEqual(v.device, { _id: "m1", name: "F1-GW01" });
});

test("ни в одном виде нет ключей WireGuard, контактов, Telegram-данных и params/where", () => {
  const people = [viewer("req"), viewer("resp"), viewer("stranger"), viewer("m", { canApprove: true, canManageConfigs: true })];
  for (const status of ["awaiting_requester", "applied"]) {
    for (const v of people) {
      const json = JSON.stringify(view(change({ status }), v));
      for (const bad of ["ENC-PRIV", "ENC-PSK", "privateKey", "presharedKey", "@x.ru", "+7999", "123", "chatId", "SECRET", "telegram"]) {
        assert.ok(!json.includes(bad), `${bad} / ${v.userId} / ${status}`);
      }
    }
  }
  const full = JSON.stringify(view(change(), viewer("req")));
  assert.ok(!full.includes('"params"') && !full.includes('"where"'));
});

test("canDownload: заявитель и решавшие, applied, ключи живы, конфиг есть", () => {
  const applied = (extra = {}) => change({
    status: "applied",
    steps: [
      { role: "requester", user: "req", decision: "approve" },
      { role: "responsible", user: "resp", decision: "approve" },
    ],
    ...extra,
  });
  assert.equal(view(applied(), viewer("req")).my.canDownload, true);
  assert.equal(view(applied(), viewer("resp")).my.canDownload, true);
  // держатель права, но не участник решения
  assert.equal(view(applied(), viewer("m", { canApprove: true, canManageConfigs: true })).my.canDownload, false);
  assert.equal(view(applied({ status: "queued" }), viewer("req")).my.canDownload, false);
  assert.equal(view(applied({ wireguard: { ...change().wireguard, keysExpireAt: new Date("2026-10-10T08:59:00Z") } }), viewer("req")).my.canDownload, false);
  assert.equal(view(applied({ wireguard: { keysExpireAt: new Date("2026-10-11T08:00:00Z") } }), viewer("req")).my.canDownload, false);
  assert.equal(view(applied({ wireguard: undefined }), viewer("req")).my.canDownload, false);
  // не решавший ответственный (запрос отклонён на первом шаге) — не скачивает
  const notDecided = applied({ steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp", decision: null }] });
  assert.equal(view(notDecided, viewer("resp")).my.canDownload, false);
});

test("истёкший по сроку открытый запрос: шаг не «мой», отзыв недоступен", () => {
  const v = view(change({ expiresAt: new Date("2026-10-10T08:00:00Z") }), viewer("req"));
  assert.deepEqual(v.my, { step: false, action: null, canCancel: false, canDownload: false });
});

test("блок конфигурации в полном виде — без секретов; id без populate не падают", () => {
  const v = view(change({ status: "applied", requestedBy: "req", responsible: null, mikrotik: "m1", backupArtifact: "a1", timeline: [{ at: NOW, text: "t", user: "req" }] }), viewer("req"));
  assert.equal(v.wireguard.client.address, "10.0.55.20/32");
  assert.equal(v.wireguard.publicKey, "PUB");
  assert.deepEqual(v.requestedBy, { _id: "req", name: "" });
  assert.deepEqual(v.backup, { artifactId: "a1", createdAt: null });
  assert.equal(v.responsible, null);
});

test("устройство: компания из записи или из карточки инвентаря, без неё ключа нет", () => {
  const own = view(change({ mikrotik: { _id: "m1", name: "F1-GW01", companyId: { alias: "F1Lab", fullTitle: "ООО Ф1" } } }), viewer("req"));
  assert.deepEqual(own.device, { _id: "m1", name: "F1-GW01", company: "F1Lab" });
  const viaCard = view(change({ mikrotik: { _id: "m1", name: "F1-GW01", clientDevice: { companyId: { fullTitle: "ООО Ф1" } } } }), viewer("req"));
  assert.equal(viaCard.device.company, "ООО Ф1");
  assert.equal(view(change(), viewer("req")).device.company, undefined);
});

test("wireguard: имя файла из комментария пира, иначе wg-<номер>", () => {
  const peer = { path: "/interface wireguard peers", action: "add", params: { comment: "i petrov/1" }, text: "t" };
  const withPeer = view(change({ commands: [peer] }), viewer("req"));
  assert.equal(withPeer.wireguard.fileName, "i_petrov_1.conf");
  assert.equal(view(change(), viewer("req")).wireguard.fileName, "wg-7.conf");
  assert.ok(!JSON.stringify(withPeer).includes('"params"'));
});

test("closedAt: время события, закрывшего запрос; поздние записи (скачивание) его не двигают; открытый — null", () => {
  const at = (iso) => new Date(iso);
  const tl = (...rows) => rows.map(([kind, iso]) => ({ kind, at: at(iso), text: kind }));
  const late = ["download", "2026-10-10T12:00:00Z"];
  const cases = [
    ["applied", tl(["decision", "2026-10-10T08:10:00Z"], ["backup", "2026-10-10T08:20:00Z"], ["result", "2026-10-10T08:30:00Z"], late), "2026-10-10T08:30:00Z"],
    ["rolled_back", tl(["result", "2026-10-10T08:31:00Z"], ["qr", "2026-10-10T12:00:00Z"]), "2026-10-10T08:31:00Z"],
    ["not_applied", tl(["result", "2026-10-10T08:32:00Z"]), "2026-10-10T08:32:00Z"],
    ["needs_attention", tl(["wait", "2026-10-10T08:10:00Z"], ["result", "2026-10-10T08:33:00Z"]), "2026-10-10T08:33:00Z"],
    ["rejected", tl(["decision", "2026-10-10T08:34:00Z"]), "2026-10-10T08:34:00Z"],
    ["expired", tl(["decision", "2026-10-10T08:05:00Z"], ["reminder", "2026-10-10T08:20:00Z"], ["expired", "2026-10-10T08:35:00Z"]), "2026-10-10T08:35:00Z"],
    ["cancelled", tl(["cancelled", "2026-10-10T08:36:00Z"]), "2026-10-10T08:36:00Z"],
  ];
  for (const [status, timeline, expected] of cases) {
    const v = view(change({ status, timeline }), viewer("req"));
    assert.equal(new Date(v.closedAt).toISOString(), new Date(expected).toISOString(), status);
  }
  for (const status of ["awaiting_requester", "awaiting_responsible", "queued", "applying"]) {
    assert.equal(view(change({ status, timeline: tl(["decision", "2026-10-10T08:10:00Z"]) }), viewer("req")).closedAt, null, status);
  }
  // нет подходящей записи — null, а не догадка по updatedAt
  assert.equal(view(change({ status: "applied", timeline: [], updatedAt: NOW }), viewer("req")).closedAt, null);
});

test("устройство без имени: подпись из карточки инвентаря («модель · SN …»), компания отдельно", () => {
  const m = { _id: "m1", clientDevice: { serialNumber: "ABC123", deviceModelId: { name: "hAP ax3" }, companyId: { alias: "F1Lab" } } };
  assert.deepEqual(view(change({ mikrotik: m }), viewer("req")).device, { _id: "m1", name: "hAP ax3 · SN ABC123", company: "F1Lab" });
  const noModel = { _id: "m1", clientDevice: { serialNumber: "ABC123" } };
  assert.equal(view(change({ mikrotik: noModel }), viewer("req")).device.name, "Устройство · SN ABC123");
  assert.equal(view(change({ mikrotik: { _id: "m1", name: "R1", clientDevice: { serialNumber: "Z" } } }), viewer("req")).device.name, "R1");
  assert.equal(view(change({ mikrotik: { _id: "m1" } }), viewer("req")).device.name, "");
});

// --- финальная волна

const withMode = (value, fn) => {
  const before = process.env.MIKROTIK_CHANGE_EXECUTOR;
  if (value === undefined) delete process.env.MIKROTIK_CHANGE_EXECUTOR;
  else process.env.MIKROTIK_CHANGE_EXECUTOR = value;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.MIKROTIK_CHANGE_EXECUTOR;
    else process.env.MIKROTIK_CHANGE_EXECUTOR = before;
  }
};

test("B4: вид говорит, есть ли автоматический откат (по режиму исполнителя)", () => {
  assert.equal(withMode(undefined, () => view(change(), viewer("req")).rollback), true);
  assert.equal(withMode("safe-mode", () => view(change(), viewer("req")).rollback), true);
  assert.equal(withMode("api", () => view(change(), viewer("req")).rollback), false);
  // сокращённый вид поля не несёт
  assert.equal(withMode("api", () => "rollback" in view(change(), viewer("stranger"))), false);
});

test("результат команды: признак отказа роутера (refused) отдаётся порталу", () => {
  const c = change({
    status: "rolled_back",
    commands: [
      { path: "/a", action: "add", text: "/a add x=1", result: { state: "failed", error: "failure: already have such entry", refused: true, at: NOW } },
      { path: "/b", action: "add", text: "/b add y=2", result: { state: "failed", error: "timed out", at: NOW } },
    ],
  });
  const v = view(c, viewer("req"));
  assert.equal(v.commands[0].result.refused, true);
  assert.equal(v.commands[1].result.refused, false);
});

test("wireguard: клиент без интерфейса (пустые массивы из базы) — блока WireGuard нет", () => {
  const v = view(change({ wireguard: { client: { allowedIps: [], dns: [] } } }), viewer("req"));
  assert.equal(v.wireguard, null);
});
