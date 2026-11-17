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
