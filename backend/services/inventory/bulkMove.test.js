require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const ClientDevice = require("../../models/inventory/clientDevice");
const Location = require("../../models/inventory/location");
const { previewMove, moveDevices } = require("./bulkMove");
const ids = {
  host: "111111111111111111111111",
  part: "111111111111111111111112",
  company: "222222222222222222222222",
  other: "222222222222222222222223",
  location: "333333333333333333333333",
};
function setup(
  t,
  { foreignPart = false, linked = false, failPart = false } = {},
) {
  const saved = [];
  const host = new ClientDevice({
    _id: ids.host,
    companyId: ids.company,
    locationId: ids.location,
    inventoryNumber: "PC-1",
    ...(linked ? { parentDeviceId: ids.part } : {}),
  });
  const part = new ClientDevice({
    _id: ids.part,
    parentDeviceId: ids.host,
    companyId: foreignPart ? ids.other : ids.company,
    locationId: ids.location,
  });
  t.mock.method(ClientDevice, "find", async (filter) =>
    filter.parentDeviceId ? [part] : [host],
  );
  t.mock.method(ClientDevice, "findById", async () => host);
  const place = {
    _id: ids.location,
    name: "Офис",
    company: ids.company,
    isPublic: true,
  };
  t.mock.method(Location, "find", () => ({ populate: async () => [place] }));
  t.mock.method(Location, "findById", async () => place);
  t.mock.method(ClientDevice.prototype, "save", async function () {
    if (failPart && String(this._id) === ids.part)
      throw Error("storage unavailable");
    saved.push(String(this._id));
    return this;
  });
  return { host, part, saved };
}
test("bulk preview rejects out-of-scope selections before revealing locations", async (t) => {
  setup(t);
  await assert.rejects(
    previewMove([ids.host], { isEndUser: true, companyId: ids.other }),
    /недоступны/,
  );
});
test("bulk preview blocks an attached component and names it", async (t) => {
  setup(t, { linked: true });
  const result = await previewMove([ids.host], { isEndUser: false });
  assert.match(result.reason, /PC-1.*сборку/);
  assert.deepEqual(result.locations, []);
});
test("bulk preview refuses hidden components, even for a visible host", async (t) => {
  setup(t, { foreignPart: true });
  const result = await previewMove([ids.host], {
    isEndUser: true,
    companyId: ids.company,
  });
  assert.match(result.reason, /недоступные комплектующие/);
});
test("bulk move always includes components and preserves company and assignee", async (t) => {
  const { host, part, saved } = setup(t);
  const result = await moveDevices([ids.host], ids.location, {
    viewer: { isEndUser: false },
    actorId: ids.company,
  });
  assert.deepEqual(result.completedIds, [ids.host]);
  assert.deepEqual(saved, [ids.host, ids.part]);
  assert.equal(String(host.companyId), ids.company);
  assert.equal(String(part.locationId), ids.location);
});
test("bulk move refuses empty destination without writes", async (t) => {
  const { saved } = setup(t);
  await assert.rejects(
    moveDevices([ids.host], null, { viewer: { isEndUser: false } }),
    /расположение/,
  );
  assert.deepEqual(saved, []);
});
test("bulk move reports a partially saved assembly instead of success", async (t) => {
  setup(t, { failPart: true });
  const result = await moveDevices([ids.host], ids.location, {
    viewer: { isEndUser: false },
    actorId: ids.company,
  });
  assert.equal(result.error, true);
  assert.equal(result.changedRecords, 1);
  assert.deepEqual(result.completedIds, []);
  assert.deepEqual(result.pendingIds, [ids.host]);
});
