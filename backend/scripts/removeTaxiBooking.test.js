require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { removeTaxiBooking } = require("./removeTaxiBooking");
const fixture = () => {
  const rows = [
    { _id: 'admin', role: 'admin', organizationId: 'org', audience: 'staff', permission: JSON.stringify({ taxi: ['read', 'order', 'dispatch', 'allocate', 'configure'], settings: ['manage'] }) },
    { _id: 'custom', role: 'custom', organizationId: 'org', audience: 'staff', permission: JSON.stringify({ taxi: ['order', 'dispatch'], ticket: ['perform'] }) },
    { _id: 'client', role: 'client', organizationId: 'other-org', audience: 'client', permission: JSON.stringify({ taxi: ['dispatch'], ticket: ['readCompanies'] }) },
    { _id: 'retained', role: 'retained', permission: JSON.stringify({ taxi: ['read'], work: ['readCost'] }) },
    { _id: 'malformed', role: 'malformed', permission: '{' },
  ];
  let receipts = true, drops = 0, writes = 0;
  const collections = [];
  const db = {
    listCollections: (filter) => { assert.deepEqual(filter, { name: 'taxiorderoperations' }); return { hasNext: async () => receipts }; },
    collection(name) {
      collections.push(name);
      if (name === 'taxiorderoperations') return { drop: async () => { assert.equal(receipts, true); receipts = false; drops++; } };
      assert.equal(name, 'organizationRole');
      return {
        find: (filter) => { assert.deepEqual(filter, {}); return { toArray: async () => rows.map((row) => ({ ...row })) }; },
        updateOne: async (filter, update) => {
          const row = rows.find((item) => item._id === filter._id && item.permission === filter.permission);
          if (!row) return { matchedCount: 0 };
          Object.assign(row, update.$set); writes++; return { matchedCount: 1 };
        },
      };
    },
  };
  return { db, rows, state: () => ({ receipts, drops, writes, collections }) };
};
test('booking cleanup removes obsolete rights from every role and drops only unused receipts once', async () => {
  const { db, rows, state } = fixture();
  const before = rows.map((row) => row.permission);
  let invalidations = 0;
  const services = { apply: true, invalidateRoles: () => { invalidations++; } };
  const dry = await removeTaxiBooking(db);
  assert.deepEqual(dry.changed, ['admin', 'custom', 'client']);
  assert.deepEqual(rows.map((row) => row.permission), before);
  assert.equal(state().writes, 0); assert.equal(state().drops, 0);
  await removeTaxiBooking(db, services);
  assert.deepEqual(JSON.parse(rows[0].permission), { taxi: ['read', 'allocate', 'configure'], settings: ['manage'] });
  assert.deepEqual(JSON.parse(rows[1].permission), { ticket: ['perform'] });
  assert.deepEqual(JSON.parse(rows[2].permission), { ticket: ['readCompanies'] });
  assert.equal(rows[3].permission, before[3]); assert.equal(rows[4].permission, before[4]);
  const retry = await removeTaxiBooking(db, services);
  assert.deepEqual(retry.changed, []); assert.equal(retry.receipts, false);
  assert.equal(state().writes, 3); assert.equal(state().drops, 1); assert.equal(invalidations, 2);
  assert.deepEqual([...new Set(state().collections)], ['organizationRole', 'taxiorderoperations']);
});
test('booking cleanup stops on a concurrently changed role before dropping receipts', async () => {
  let dropped = false;
  const db = { collection(name) {
    if (name === 'taxiorderoperations') return { drop: async () => { dropped = true; } };
    return { find: () => ({ toArray: async () => [{ _id: 'role', role: 'custom', permission: '{"taxi":["order"]}' }] }), updateOne: async () => ({ matchedCount: 0 }) };
  } };
  await assert.rejects(removeTaxiBooking(db, { apply: true, invalidateRoles() {} }), /Роль изменилась/);
  assert.equal(dropped, false);
});
