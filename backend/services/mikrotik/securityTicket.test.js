require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");

const device = { _id: new Types.ObjectId(), name: "Office", currentFirmware: "7.1" };
const query = (value) => ({ select() { return this; }, lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const stateModel = { findOneAndUpdate() {}, findById() {}, updateOne() {} };
const tickets = new Map();
const ticketModel = { findById: (id) => query(tickets.get(String(id))), findOne: () => query(null) };
function stub(path, exports) {
  require.cache[require.resolve(path)] = { loaded: true, exports };
}
stub("../../models/ticket", { Ticket: ticketModel });
stub("../../models/preferences", { findOne: () => query({ mikrotik: { securityUpdateTicket: { isActive: true } } }) });
stub("../../models/mikrotik", { find: () => query([device]) });
stub("../../models/mikrotikFirmware", { MikrotikFirmwareState: stateModel });
stub("./firmware", { evaluateFirmware: () => ({ vulnerable: true, cves: [], installedVersion: "7.1", latestVersion: "7.2" }) });
const writer = { createMikrotikSystemTicket() {}, deviceLabel: (r) => r.name, deviceLinkHtml: () => "" };
stub("./tickets", writer);

for (const alreadyCreated of [false, true]) {
  test(`restart after claim with ticket already created = ${alreadyCreated}`, async (t) => {
    tickets.clear();
    const state = { _id: "security-ticket", items: [] };
    let interrupted = true;
    const matches = (filter) => Object.entries(filter).every(([key, value]) =>
      value == null ? state[key] == null : String(state[key]) === String(value));
    const apply = (update) => {
      Object.assign(state, update.$set);
      for (const key of Object.keys(update.$unset || {})) delete state[key];
    };
    t.mock.method(stateModel, "findOneAndUpdate", async (filter, update, opts) => {
      if (!matches(filter)) return null;
      const old = { ...state };
      apply(update);
      return opts.new ? { ...state } : old;
    });
    t.mock.method(stateModel, "updateOne", async (filter, update) => {
      if (matches(filter)) apply(update);
    });
    const writes = [];
    t.mock.method(writer, "createMikrotikSystemTicket", async (payload) => {
      const id = payload.ticketId ?? new Types.ObjectId();
      if (alreadyCreated || !interrupted) {
        writes.push(String(id));
        tickets.set(String(id), { _id: id, isClosed: false });
      }
      if (interrupted) throw new Error("simulated process interruption");
      return tickets.get(String(id));
    });
    delete require.cache[require.resolve("./securityTicket")];
    const { syncSecurityTicket } = require("./securityTicket");
    await syncSecurityTicket({ minSeverity: "high" });
    interrupted = false;
    await syncSecurityTicket({ minSeverity: "high" });
    assert.ok(state.ticketId);
    assert.deepEqual(writes, [String(state.ticketId)]);
    assert.equal(String(state.items[0].recordId), String(device._id));
  });
}

test("recovers the checklist of an open ticket from a legacy timestamp-only claim", async (t) => {
  const ticket = {
    _id: new Types.ObjectId(),
    description: `<b>«Office»</b> (—)<br/>RouterOS 7.1 → 7.2<br/>Уязвимости: CVE<br/>` +
      `<a href="/devices/mikrotik/records/${device._id}">Открыть страницу устройства</a><br/>`,
  };
  const state = { _id: "security-ticket", claimedAt: new Date(0), items: [] };
  t.mock.method(ticketModel, "findOne", (filter) => {
    assert.equal(filter.isClosed, false);
    assert.deepEqual(filter.createdAt.$gte, state.claimedAt);
    return query(ticket);
  });
  t.mock.method(ticketModel, "findById", () => query(ticket));
  t.mock.method(stateModel, "findOneAndUpdate", async () => state);
  t.mock.method(stateModel, "findById", async () => state);
  t.mock.method(stateModel, "updateOne", async (guard, update) => {
    assert.equal(guard.claimedAt.getTime(), 0);
    Object.assign(state, update.$set);
    delete state.claimedAt;
  });
  delete require.cache[require.resolve("./securityTicket")];
  await require("./securityTicket").syncSecurityTicket({ minSeverity: "high" });
  assert.equal(state.ticketId, ticket._id);
  assert.deepEqual(state.items, [{
    recordId: String(device._id), description: "«Office» (—): RouterOS 7.1 → 7.2", safe: false,
  }]);
});
