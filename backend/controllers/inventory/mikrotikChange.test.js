// node --test controllers/inventory/mikrotikChange.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createController } = require("./mikrotikChange");
const { createDecisions } = require("@/services/mikrotik/changeDecisions");

const NOW = new Date("2026-10-10T09:00:00Z");
const clone = (v) => structuredClone(v);
const person = (id, first, last) => ({ _id: id, firstName: first, lastName: last, email: `${id}@x.ru` });
const NAMES = { req: person("req", "Иван", "Петров"), resp: person("resp", "Анна", "Смирнова"), other: person("other", "Олег", "Чужой") };

const baseDoc = (extra = {}) => ({
  _id: "64f100000000000000000001",
  number: 7,
  title: "WireGuard",
  status: "awaiting_requester",
  risk: "normal",
  expiresAt: new Date("2026-10-11T09:00:00Z"),
  createdAt: new Date("2026-10-10T08:00:00Z"),
  mikrotik: "64f1000000000000000000aa",
  requestedBy: "req",
  responsible: "resp",
  steps: [
    { role: "requester", user: "req", decision: null },
    { role: "responsible", user: "resp", decision: null },
  ],
  commands: [{ path: "/interface wireguard peers", action: "add", text: "/interface wireguard peers add", params: { comment: "Иван телефон" }, result: { state: "pending" } }],
  timeline: [],
  ...extra,
});

// Один «документ» на всё: хранилище решений и репозиторий смотрят в него
function harness({ doc = baseDoc(), log } = {}) {
  const state = { doc: clone(doc), timeline: [], sent: [], configArgs: null };
  const hydrate = (d) => ({
    ...clone(d),
    requestedBy: NAMES[d.requestedBy] || d.requestedBy,
    responsible: NAMES[d.responsible] || d.responsible,
    steps: d.steps.map((s) => ({ ...s, user: NAMES[s.user] || s.user })),
  });
  const store = {
    async load(id) { await Promise.resolve(); return id === state.doc._id ? clone(state.doc) : null; },
    async userName(id) { const u = NAMES[id]; return u ? `${u.firstName} ${u.lastName}` : ""; },
    async applyPatch(id, status, index, patch) {
      const d = state.doc;
      if (d._id !== id || d.status !== status || d.steps[index].decision) return null;
      d.status = patch.status;
      Object.assign(d.steps[index], { decision: patch.step.decision, channel: patch.step.channel, comment: patch.step.comment, decidedAt: patch.step.decidedAt });
      d.timeline.push(patch.timeline);
      return clone(d);
    },
    async applyCancel(id, status, { timeline }) {
      const d = state.doc;
      if (d._id !== id || d.status !== status) return null;
      d.status = "cancelled"; d.timeline.push(timeline);
      return clone(d);
    },
  };
  const notifier = {
    step: async () => void state.sent.push("step"),
    decided: async () => void state.sent.push("decided"),
    cancelled: async () => void state.sent.push("cancelled"),
  };
  const decisions = createDecisions({ store, notifier, now: () => NOW, log: { log() {} } });
  const repo = {
    async findById(id, { secrets } = {}) {
      if (id !== state.doc._id) return null;
      if (secrets) state.secretReads = (state.secretReads || 0) + 1;
      const d = hydrate(state.doc);
      if (!secrets && d.wireguard) { delete d.wireguard.privateKey; delete d.wireguard.presharedKey; }
      return d;
    },
    async listByRecord() { return [hydrate(state.doc)]; },
    async recordExists(id) { return id === REC; },
    async listAwaiting() { return state.awaiting ? state.awaiting.map(hydrate) : [hydrate(state.doc)]; },
    async pushTimeline(id, entry) { state.timeline.push(entry); },
    async userName(id) { return store.userName(id); },
  };
  const controller = createController({
    decisions, repo, now: () => NOW, log,
    decryptSecret: (s) => s.replace(/^enc:/, ""),
    buildClientConfig: (args) => { state.configArgs = args; return `CONF(${args.privateKey})\n`; },
  });
  return { controller, state };
}

function call(handler, { userId, can = [], params = {}, body = {}, query = {} } = {}) {
  const req = {
    userId, params, body, query,
    auth: { can: (q) => Object.entries(q).every(([r, acts]) => acts.every((a) => can.includes(`${r}.${a}`))) },
  };
  const out = { headers: {} };
  const res = {
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
    send(b) { out.text = b; return this; },
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; return this; },
    set(k, v) { return this.setHeader(k, v); },
  };
  return handler(req, res, (e) => { out.error = e; }).then(() => out);
}
const ID = "64f100000000000000000001";
const REC = "64f1000000000000000000aa";

// ---------------------------------------------------------------- решения

test("decision: заявитель подтверждает; право берётся из сессии, ответ — вид запроса", async () => {
  const { controller, state } = harness();
  const out = await call(controller.decide, { userId: "req", params: { id: ID }, body: { decision: "approve", comment: " ок\nхорошо " } });
  assert.equal(out.error, undefined);
  assert.equal(out.status, 200);
  assert.equal(out.body.status, "awaiting_responsible");
  assert.equal(state.doc.steps[0].channel, "portal");
  assert.equal(state.doc.steps[0].comment, "ок хорошо");
  assert.deepEqual(state.sent, ["step"]);
});

test("decision: право из тела запроса игнорируется — ответственный без права получает 403", async () => {
  const doc = baseDoc({ status: "awaiting_responsible", steps: [
    { role: "requester", user: "req", decision: "approve" },
    { role: "responsible", user: "resp", decision: null },
  ] });
  const { controller, state } = harness({ doc });
  const out = await call(controller.decide, { userId: "resp", can: [], params: { id: ID }, body: { decision: "approve", canApprove: true } });
  assert.equal(out.error.statusCode, 403);
  assert.equal(out.error.message, "Нет права утверждать запросы ИИ-агентов по устройствам Mikrotik");
  assert.deepEqual(state.sent, []);
  const ok = await call(controller.decide, { userId: "resp", can: ["mikrotik.approveChanges"], params: { id: ID }, body: { decision: "approve" } });
  assert.equal(ok.body.status, "queued");
});

test("decision: двойной вызов — второй 409, уведомление одно", async () => {
  const { controller, state } = harness();
  const args = { userId: "req", params: { id: ID }, body: { decision: "approve" } };
  const [a, b] = await Promise.all([call(controller.decide, args), call(controller.decide, args)]);
  const errors = [a, b].filter((o) => o.error);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error.statusCode, 409);
  assert.equal(errors[0].error.message, "Запрос уже решён");
  assert.deepEqual(state.sent, ["step"]);
  // шаг ушёл дальше: тот же человек уже не «за шагом»
  const third = await call(controller.decide, args);
  assert.equal(third.error.statusCode, 403);
});

test("decision: коды not_yours 403, expired 410, неизвестный id 404, мусорный id 404", async () => {
  const { controller } = harness();
  const other = await call(controller.decide, { userId: "other", can: ["mikrotik.read"], params: { id: ID }, body: { decision: "reject" } });
  assert.equal(other.error.statusCode, 403);
  const expired = harness({ doc: baseDoc({ expiresAt: new Date("2026-10-10T08:00:00Z") }) });
  assert.equal((await call(expired.controller.decide, { userId: "req", params: { id: ID }, body: { decision: "approve" } })).error.statusCode, 410);
  assert.equal((await call(controller.decide, { userId: "req", params: { id: "64f1000000000000000000ff" }, body: { decision: "approve" } })).error.statusCode, 404);
  assert.equal((await call(controller.decide, { userId: "req", params: { id: "not-an-id" }, body: { decision: "approve" } })).error.statusCode, 404);
});

test("decision: плохое тело — 400, записи нет", async () => {
  const { controller, state } = harness();
  for (const body of [{}, { decision: "maybe" }, { decision: "approve", comment: "x".repeat(301) }, { decision: "approve", comment: 5 }, { decision: ["approve"] }]) {
    const out = await call(controller.decide, { userId: "req", params: { id: ID }, body });
    assert.equal(out.error.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(state.doc.status, "awaiting_requester");
});

test("cancel: заявитель 200, чужой 403, повторно 409", async () => {
  const { controller, state } = harness();
  assert.equal((await call(controller.cancel, { userId: "resp", params: { id: ID } })).error.statusCode, 403);
  const ok = await call(controller.cancel, { userId: "req", params: { id: ID } });
  assert.equal(ok.body.status, "cancelled");
  assert.deepEqual(state.sent, ["cancelled"]);
  assert.equal((await call(controller.cancel, { userId: "req", params: { id: ID } })).error.statusCode, 409);
});

// ---------------------------------------------------------------- виды

test("getOne: заявитель — полный вид, посторонний — урезанный", async () => {
  const { controller } = harness();
  const full = await call(controller.getOne, { userId: "req", params: { id: ID } });
  assert.ok(full.body.commands);
  const reduced = await call(controller.getOne, { userId: "other", can: ["mikrotik.read"], params: { id: ID } });
  assert.equal(reduced.body.commands, undefined);
  assert.equal(reduced.body.number, 7);
  const approver = await call(controller.getOne, { userId: "other", can: ["mikrotik.approveChanges"], params: { id: ID } });
  assert.ok(approver.body.commands);
  assert.equal((await call(controller.getOne, { userId: "req", params: { id: "64f1000000000000000000ff" } })).error.statusCode, 404);
});

test("list по записи: каждый через toView, неизвестная запись — 404", async () => {
  const { controller } = harness();
  const out = await call(controller.listForRecord, { userId: "other", can: ["mikrotik.read"], params: { recordId: REC } });
  assert.equal(out.body.length, 1);
  assert.equal(out.body[0].commands, undefined);
  assert.equal((await call(controller.listForRecord, { userId: "other", params: { recordId: "nope" } })).error.statusCode, 404);
});

test("awaiting-me: только открытые, не истёкшие, чей текущий шаг за смотрящим", async () => {
  const mine = baseDoc();
  const decided = baseDoc({ _id: "d", status: "awaiting_responsible", steps: [{ role: "requester", user: "req", decision: "approve" }, { role: "responsible", user: "resp", decision: null }] });
  const expired = baseDoc({ _id: "e", expiresAt: new Date("2026-10-10T08:00:00Z") });
  const closed = baseDoc({ _id: "f", status: "applied" });
  const h = harness();
  h.state.awaiting = [mine, decided, expired, closed];
  const out = await call(h.controller.awaitingMe, { userId: "req" });
  assert.deepEqual(out.body.map((v) => v._id), [ID]);
  const resp = await call(h.controller.awaitingMe, { userId: "resp" });
  assert.deepEqual(resp.body.map((v) => v._id), ["d"]);
});

// ---------------------------------------------------------------- конфигурация

const applied = (extra = {}) => baseDoc({
  status: "applied",
  steps: [
    { role: "requester", user: "req", decision: "approve" },
    { role: "responsible", user: "resp", decision: "approve" },
  ],
  wireguard: {
    publicKey: "PUB", privateKey: "enc:PRIV", presharedKey: "enc:PSK", serverPublicKey: "SRV", endpoint: "h:1",
    keysExpireAt: new Date("2026-10-11T08:00:00Z"),
    client: { address: "10.0.55.20/32", allowedIps: ["10.0.20.0/24"], dns: ["10.0.20.1"], endpoint: "h:2" },
  },
  ...extra,
});

test("wireguard.conf: заявитель получает файл; заголовки, no-store, хроника, ключи расшифрованы", async () => {
  const { controller, state } = harness({ doc: applied() });
  const out = await call(controller.downloadWireguard, { userId: "req", params: { id: ID } });
  assert.equal(out.error, undefined);
  assert.equal(out.status, 200);
  assert.equal(out.text, "CONF(PRIV)\n");
  assert.equal(out.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(out.headers["cache-control"], "no-store");
  assert.match(out.headers["content-disposition"], /^attachment; filename="wg-7\.conf"$/);
  assert.deepEqual(state.timeline.map((t) => t.text), ["Скачана конфигурация: Иван Петров"]);
  assert.equal(state.timeline[0].kind, "download");
  assert.deepEqual(state.configArgs, {
    privateKey: "PRIV", address: "10.0.55.20/32", dns: ["10.0.20.1"], serverPublicKey: "SRV",
    presharedKey: "PSK", endpoint: "h:2", allowedIps: ["10.0.20.0/24"],
  });
  // ответственный, решавший шаг, тоже может
  assert.equal((await call(controller.downloadWireguard, { userId: "resp", params: { id: ID } })).status, 200);
});

test("wireguard.conf: чужому 403 (даже с правами), ничего не расшифровано и не записано", async () => {
  const { controller, state } = harness({ doc: applied() });
  for (const can of [["mikrotik.read"], ["mikrotik.approveChanges", "mikrotik.manageConfigs"]]) {
    const out = await call(controller.downloadWireguard, { userId: "other", can, params: { id: ID } });
    assert.equal(out.error.statusCode, 403);
    assert.equal(out.text, undefined);
  }
  assert.equal(state.configArgs, null);
  assert.deepEqual(state.timeline, []);
});

test("wireguard.conf: после keysExpireAt или без стёртых ключей — 410", async () => {
  const expired = harness({ doc: applied({ wireguard: { ...applied().wireguard, keysExpireAt: new Date("2026-10-10T08:59:00Z") } }) });
  assert.equal((await call(expired.controller.downloadWireguard, { userId: "req", params: { id: ID } })).error.statusCode, 410);
  const purged = harness({ doc: applied({ wireguard: { ...applied().wireguard, privateKey: undefined } }) });
  assert.equal((await call(purged.controller.downloadWireguard, { userId: "req", params: { id: ID } })).error.statusCode, 410);
  assert.equal(expired.state.configArgs, null);
});

test("wireguard.conf: запрос не применён — 409; без конфигурации — 404", async () => {
  const notYet = harness({ doc: applied({ status: "queued" }) });
  assert.equal((await call(notYet.controller.downloadWireguard, { userId: "req", params: { id: ID } })).error.statusCode, 409);
  const none = harness({ doc: applied({ wireguard: undefined }) });
  assert.equal((await call(none.controller.downloadWireguard, { userId: "req", params: { id: ID } })).error.statusCode, 404);
});

test("wireguard.conf: имя файла только из [A-Za-z0-9._-]", async () => {
  const name = async (comment) => {
    const doc = applied();
    doc.commands[0].params.comment = comment;
    const { controller } = harness({ doc });
    const out = await call(controller.downloadWireguard, { userId: "req", params: { id: ID } });
    return out.headers["content-disposition"];
  };
  assert.equal(await name("ivan-phone.1"), 'attachment; filename="ivan-phone.1.conf"');
  assert.equal(await name('a"b\r\nSet-Cookie: x/../c'), 'attachment; filename="a_b_Set-Cookie_x_.._c.conf"');
  assert.equal(await name("Иван телефон"), 'attachment; filename="wg-7.conf"');
  assert.equal(await name(".hidden"), 'attachment; filename="hidden.conf"');
  assert.equal(await name("x".repeat(200)), `attachment; filename="${"x".repeat(64)}.conf"`);
});

test("wireguard.conf: сбой записи в хронику — файл не отдаётся", async () => {
  const h = harness({ doc: applied() });
  const c = createController({
    decisions: { decide: async () => ({}), cancel: async () => ({}) },
    repo: { findById: async () => ({ ...applied(), requestedBy: NAMES.req, steps: applied().steps }), pushTimeline: async () => { throw new Error("db"); }, userName: async () => "x" },
    now: () => NOW, decryptSecret: (s) => s, buildClientConfig: () => "CONF",
  });
  const out = await call(c.downloadWireguard, { userId: "req", params: { id: ID } });
  assert.ok(out.error);
  assert.equal(out.text, undefined);
  assert.ok(h);
});

// ---------------------------------------------------------------- раунд 1

test("сотрудник без прав на Mikrotik: заявитель всё делает со своим запросом", async () => {
  const doc = applied({ steps: [
    { role: "requester", user: "req", decision: "approve" },
    { role: "responsible", user: "resp", decision: "approve" },
  ] });
  const h = harness({ doc });
  const one = await call(h.controller.getOne, { userId: "req", can: [], params: { id: ID } });
  assert.ok(one.body.commands);
  assert.equal((await call(h.controller.downloadWireguard, { userId: "req", can: [], params: { id: ID } })).status, 200);
  const open = harness();
  assert.equal((await call(open.controller.decide, { userId: "req", can: [], params: { id: ID }, body: { decision: "approve" } })).body.status, "awaiting_responsible");
  const open2 = harness();
  assert.equal((await call(open2.controller.cancel, { userId: "req", can: [], params: { id: ID } })).body.status, "cancelled");
});

test("getOne: сотрудник без прав и не участник — 404; с read — урезанный вид; участник — полный", async () => {
  const { controller } = harness();
  const none = await call(controller.getOne, { userId: "other", can: [], params: { id: ID } });
  assert.equal(none.error.statusCode, 404);
  assert.equal(none.body, undefined);
  const reader = await call(controller.getOne, { userId: "other", can: ["mikrotik.read"], params: { id: ID } });
  assert.equal(reader.body.commands, undefined);
  const approverOnly = await call(controller.getOne, { userId: "other", can: ["mikrotik.approveChanges"], params: { id: ID } });
  assert.ok(approverOnly.body.commands);
  const resp = await call(controller.getOne, { userId: "resp", can: [], params: { id: ID } });
  assert.ok(resp.body.commands);
});

test("ответственный с approveChanges без read: awaiting-me и решение работают", async () => {
  const doc = baseDoc({ status: "awaiting_responsible", steps: [
    { role: "requester", user: "req", decision: "approve" },
    { role: "responsible", user: "resp", decision: null },
  ] });
  const { controller } = harness({ doc });
  const can = ["mikrotik.approveChanges"];
  assert.equal((await call(controller.awaitingMe, { userId: "resp", can })).body.length, 1);
  assert.equal((await call(controller.decide, { userId: "resp", can, params: { id: ID }, body: { decision: "approve" } })).body.status, "queued");
});

test("скачивание: сбой логируется причиной и номером, без секретов; клиенту 500", async () => {
  const lines = [];
  const log = { log: (level, message, meta) => lines.push({ level, message, meta }) };
  const h = createController({
    decisions: {},
    repo: { findById: async () => ({ ...applied(), requestedBy: NAMES.req }), pushTimeline: async () => {}, userName: async () => "x" },
    now: () => NOW, log,
    decryptSecret: () => { throw new Error("bad auth tag"); },
    buildClientConfig: () => "",
  });
  const out = await call(h.downloadWireguard, { userId: "req", params: { id: ID } });
  assert.equal(out.error.statusCode, 500);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].meta.number, 7);
  assert.equal(lines[0].meta.error, "bad auth tag");
  assert.ok(!JSON.stringify(lines).includes("PRIV"));
});

// ---------------------------------------------------------------- показ QR

test("wireguard.conf?via=qr: конфиг отдаётся, в хронике «Показан QR-код», не «Скачана»", async () => {
  const { controller, state } = harness({ doc: applied() });
  const out = await call(controller.downloadWireguard, { userId: "req", params: { id: ID }, query: { via: "qr" } });
  assert.equal(out.status, 200);
  assert.equal(out.text, "CONF(PRIV)\n");
  assert.deepEqual(state.timeline.map((t) => [t.kind, t.text]), [["qr", "Показан QR-код конфигурации: Иван Петров"]]);
});

test("wireguard.conf?via=qr: не чаще одной записи на человека за 10 минут; чужое значение via — обычное скачивание", async () => {
  const recent = { at: new Date("2026-10-10T08:55:00Z"), kind: "qr", user: "req", text: "Показан QR-код конфигурации: Иван Петров" };
  const again = harness({ doc: applied({ timeline: [recent] }) });
  const out = await call(again.controller.downloadWireguard, { userId: "req", params: { id: ID }, query: { via: "qr" } });
  assert.equal(out.status, 200);
  assert.equal(again.state.timeline.length, 0);
  // другой человек пишет свою запись
  const other = await call(again.controller.downloadWireguard, { userId: "resp", params: { id: ID }, query: { via: "qr" } });
  assert.equal(other.status, 200);
  assert.equal(again.state.timeline.length, 1);
  // старая запись (больше 10 минут) не мешает
  const old = harness({ doc: applied({ timeline: [{ ...recent, at: new Date("2026-10-10T08:40:00Z") }] }) });
  await call(old.controller.downloadWireguard, { userId: "req", params: { id: ID }, query: { via: "qr" } });
  assert.equal(old.state.timeline.length, 1);
  // только литерал qr
  const odd = harness({ doc: applied() });
  await call(odd.controller.downloadWireguard, { userId: "req", params: { id: ID }, query: { via: "QR" } });
  assert.equal(odd.state.timeline[0].kind, "download");
});

test("сотрудник без прав на Mikrotik и не участник: решение, отзыв и скачивание отвечают 404, как и просмотр", async () => {
  const { controller, state } = harness({ doc: applied() });
  const open = harness();
  const decide = await call(open.controller.decide, { userId: "other", params: { id: ID }, body: { decision: "approve" } });
  const cancel = await call(open.controller.cancel, { userId: "other", params: { id: ID } });
  const download = await call(controller.downloadWireguard, { userId: "other", params: { id: ID } });
  const closed = await call(controller.decide, { userId: "other", params: { id: ID }, body: { decision: "approve" } });
  for (const out of [decide, cancel, download, closed]) assert.equal(out.error.statusCode, 404);
  assert.equal(open.state.doc.status, "awaiting_requester");
  assert.deepEqual(open.state.sent, []);
  assert.equal(state.configArgs, null);
});

test("wireguard.conf: секреты читаются из базы только для получателя", async () => {
  const { controller, state } = harness({ doc: applied() });
  const asked = [];
  const original = controller.downloadWireguard;
  state.secretsAsked = asked;
  await call(original, { userId: "other", can: ["mikrotik.read"], params: { id: ID } });
  assert.deepEqual(state.secretReads || 0, 0);
  await call(original, { userId: "req", params: { id: ID } });
  assert.equal(state.secretReads, 1);
});

test("list по записи: без прав на Mikrotik в списке только свои запросы (на случай, если гейт маршрута снимут)", async () => {
  const { controller } = harness();
  const stranger = await call(controller.listForRecord, { userId: "other", params: { recordId: REC } });
  assert.deepEqual(stranger.body, []);
  const own = await call(controller.listForRecord, { userId: "req", params: { recordId: REC } });
  assert.equal(own.body.length, 1);
  const reader = await call(controller.listForRecord, { userId: "other", can: ["mikrotik.read"], params: { recordId: REC } });
  assert.equal(reader.body.length, 1);
});
