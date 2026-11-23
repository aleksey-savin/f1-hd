require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const { Resource } = require("../../models/proxmox");
const core = require("./core");
const controller = require("../../controllers/proxmox");
const company = "222222222222222222222222";
function setup(t, count = 1) {
  const saved = [];
  const rows = Array.from({ length: count }, (_, i) => ({
    _id: (i + 1).toString(16).padStart(24, "0"),
    name: `VM ${i + 1}`,
    kind: "guest",
    companyId: null,
    async save() {
      saved.push(this._id);
    },
  }));
  t.mock.method(Resource, "find", async (filter) => {
    assert.equal(filter.archived, false);
    return rows;
  });
  t.mock.method(core, "activeCompany", async () => company);
  t.mock.method(require("../../models/company"), "find", () => ({ select: () => ({ lean: async () => [{ _id: company, alias: "Компания Б" }] }) }));
  t.mock.method(core, "event", async () => {});
  const req = {
    body: { ids: rows.map((r) => r._id), companyId: company },
    params: { kind: "guests" },
    auth: { userId: company, isEndUser: false, can: () => true },
  };
  let response;
  const res = {
    json(value) {
      response = value;
    },
  };
  return { rows, saved, req, res, response: () => response };
}
test("company assignment supports an entire selection above 100", async (t) => {
  const s = setup(t, 135);
  await controller.company(s.req, s.res);
  assert.equal(s.saved.length, 135);
  assert.equal(s.response().completedIds.length, 135);
});
test("a linked inventory conflict prevents all writes", async (t) => {
  const s = setup(t, 2);
  s.req.params.kind = "nodes";
  s.rows.forEach(r => { r.kind = "node"; });
  s.rows[1].clientDeviceId = company;
  await assert.rejects(controller.company(s.req, s.res), /инвентаря/);
  assert.deepEqual(s.saved, []);
});
test("technical failure reports completed resources", async (t) => {
  const s = setup(t, 2);
  s.rows[1].save = async () => {
    throw Error("storage error");
  };
  await controller.company(s.req, s.res);
  assert.equal(s.response().error, true);
  assert.deepEqual(s.response().completedIds, [s.rows[0]._id]);
});

test("legacy guest inventory links do not block company change and stay stored", async (t) => {
  const s = setup(t);
  s.rows[0].clientDeviceId = company;
  await controller.company(s.req, s.res);
  assert.equal(s.saved.length, 1);
  assert.equal(s.rows[0].clientDeviceId, company);
});
test("new company events contain names and structured snapshots", async (t) => {
  const s = setup(t);
  let event;
  t.mock.method(core, "event", async (...args) => { event = args; });
  await controller.company(s.req, s.res);
  assert.equal(event[2], "Привязка компании изменена (не назначена → Компания Б)");
  assert.equal(event[4].companyChange.to.name, "Компания Б");
});
test("guest inventory link endpoint rejects without changing legacy link", async (t) => {
  const s = setup(t);
  s.rows[0].clientDeviceId = company;
  t.mock.method(Resource, "findById", async () => s.rows[0]);
  t.mock.method(require("../../models/preferences"), "findOne", () => ({ lean: async () => ({ modules: { inventory: { isActive: true } } }) }));
  s.req.params.id = s.rows[0]._id;
  await assert.rejects(controller.inventory(s.req, s.res), /узел/);
  assert.equal(s.saved.length, 0);
  assert.equal(s.rows[0].clientDeviceId, company);
});

test("inventory linking requires a company and guards concurrent ownership changes", async t => {
  const s = setup(t);
  const node = s.rows[0];
  node.kind = "node";
  const cardId = "333333333333333333333333";
  const card = { _id: cardId, companyId: null };
  t.mock.method(Resource, "findById", async () => node);
  t.mock.method(require("../../models/inventory/clientDevice"), "findById", async () => card);
  t.mock.method(require("../../models/preferences"), "findOne", () => ({ lean: async () => ({ modules: { inventory: { isActive: true } } }) }));
  s.req.params.id = node._id;
  s.req.body.clientDeviceId = cardId;
  await assert.rejects(controller.inventory(s.req, s.res), /Компания/);
  assert.deepEqual(s.saved, []);
  node.companyId = company;
  card.companyId = company;
  await controller.inventory(s.req, s.res);
  assert.deepEqual(node.$where, { companyId: company, clientDeviceId: null });
  assert.equal(node.clientDeviceId, cardId);
});
