require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { staffAccessStatements } = require("../auth/access");
const { upgradeProxmoxRoles } = require("./grantProxmoxPermissions");

const previousAdmin = () => {
  const statements = staffAccessStatements();
  delete statements.proxmox;
  return statements;
};

const fixture = (rows) => {
  const writes = [];
  const refreshed = [];
  let invalidations = 0;
  const db = { collection(name) {
    assert.equal(name, "organizationRole");
    return {
      find(filter) {
        assert.deepEqual(filter, { organizationId: "org" });
        return { toArray: async () => rows.map((row) => ({ ...row })) };
      },
      updateOne: async (filter, change) => {
        const row = rows.find((item) => item._id === filter._id && item.permission === filter.permission);
        if (!row) return { matchedCount: 0 };
        Object.assign(row, change.$set);
        writes.push(filter._id);
        return { matchedCount: 1 };
      },
    };
  } };
  const services = {
    invalidateRoles() { invalidations++; },
    refreshMirrorFor: async (orgId, key) => {
      assert.equal(orgId, "org");
      assert.ok(invalidations > 0, "invalidate cached permissions before refreshing mirrors");
      refreshed.push(key);
    },
  };
  return { db, services, writes, refreshed, invalidations: () => invalidations };
};

test("Proxmox grant previews and upgrades administrative staff roles while preserving other permissions", async () => {
  const previous = previousAdmin();
  const custom = { ...previous, taxi: ["read"], ticket: previous.ticket.filter((action) => action !== "closeWithoutWork"), proxmox: ["read"] };
  const rows = [
    { _id: "a", role: "renamed-admin", audience: "staff", permission: JSON.stringify(previous) },
    { _id: "b", role: "custom-admin", audience: "staff", permission: JSON.stringify(custom) },
    { _id: "c", role: "legacy-admin", permission: JSON.stringify(previous) },
    { _id: "d", role: "client-admin", audience: "client", permission: JSON.stringify(previous) },
    { _id: "e", role: "admin", audience: "staff", permission: JSON.stringify({ ...previous, settings: [] }) },
    { _id: "f", role: "broken", audience: "staff", permission: "{" },
  ];
  const before = rows.map((row) => row.permission);
  const f = fixture(rows);
  const dry = await upgradeProxmoxRoles(f.db, "org", f.services);
  assert.deepEqual(dry.changed, ["renamed-admin", "custom-admin", "legacy-admin"]);
  assert.deepEqual(rows.map((row) => row.permission), before);
  assert.equal(f.invalidations(), 0);
  assert.deepEqual(f.refreshed, []);
  await upgradeProxmoxRoles(f.db, "org", { apply: true, ...f.services });
  for (const index of [0, 1, 2]) {
    assert.deepEqual(JSON.parse(rows[index].permission), {
      ...JSON.parse(before[index]), proxmox: ["read", "manage", "power", "backup", "discover"],
    });
  }
  for (const index of [3, 4, 5]) assert.equal(rows[index].permission, before[index]);
  assert.deepEqual(f.refreshed, ["renamed-admin", "legacy-admin"]);
  const retry = await upgradeProxmoxRoles(f.db, "org", { apply: true, ...f.services });
  assert.deepEqual(retry.changed, []);
  assert.deepEqual(f.writes, ["a", "b", "c"]);
});

test("Proxmox grant restores full-access mirrors when retried after a failed mirror update", async () => {
  const rows = [{ _id: "a", role: "administrator", audience: "staff", permission: JSON.stringify(previousAdmin()) }];
  const f = fixture(rows);
  await assert.rejects(upgradeProxmoxRoles(f.db, "org", {
    apply: true, ...f.services,
    refreshMirrorFor: async () => { throw new Error("mirror interrupted"); },
  }), /mirror interrupted/);
  const retry = await upgradeProxmoxRoles(f.db, "org", { apply: true, ...f.services });
  assert.deepEqual(retry.changed, []);
  assert.deepEqual(f.writes, ["a"]);
  assert.deepEqual(f.refreshed, ["administrator"]);
});

test("Proxmox grant stops if a role changed since it was read", async () => {
  const rows = [{ _id: "a", role: "administrator", audience: "staff", permission: JSON.stringify(previousAdmin()) }];
  const f = fixture(rows);
  const collection = f.db.collection;
  f.db.collection = (name) => ({ ...collection(name), updateOne: async () => ({ matchedCount: 0 }) });
  await assert.rejects(upgradeProxmoxRoles(f.db, "org", { apply: true, ...f.services }), /Роль изменилась/);
  assert.deepEqual(f.refreshed, []);
});
