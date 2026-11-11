require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { staffAccessStatements } = require('../auth/access');
const { upgradeTicketMessagingRoles } = require('./grantTicketMessaging');
const fixture = rows => {
  const refreshed = [], writes = [];
  const db = { collection: () => ({ find: () => ({ toArray: async () => rows.map(row => ({ ...row })) }), updateOne: async (filter, update) => {
    const row = rows.find(row => row._id === filter._id && row.permission === filter.permission);
    if (!row) return { matchedCount: 0 };
    Object.assign(row, update.$set); writes.push(row.role); return { matchedCount: 1 };
  } }) };
  return { db, refreshed, writes, options: { apply: true, invalidateRoles() {}, refreshMirrorFor: async (_org, key) => refreshed.push(key) } };
};
test('migration preserves existing ticket sending without adding inbox access; clients and non-senders stay unchanged', async () => {
  const previous = staffAccessStatements(); previous.ticket = previous.ticket.filter(action => action !== 'sendMessage');
  const rows = [
    { _id: 1, role: 'sender', audience: 'staff', permission: JSON.stringify({ conversation: ['reply'], ticket: ['perform'] }) },
    { _id: 2, role: 'reader', audience: 'staff', permission: JSON.stringify({ conversation: ['read'] }) },
    { _id: 3, role: 'client', audience: 'client', permission: JSON.stringify({ conversation: ['reply'] }) },
    { _id: 4, role: 'administrator', audience: 'staff', permission: JSON.stringify(previous) },
  ];
  const f = fixture(rows);
  const before = rows.map(row => row.permission);
  assert.deepEqual((await upgradeTicketMessagingRoles(f.db, 'org')).changed, ['sender', 'administrator']);
  assert.deepEqual(rows.map(row => row.permission), before);
  await upgradeTicketMessagingRoles(f.db, 'org', f.options);
  assert.deepEqual(JSON.parse(rows[0].permission), { conversation: ['reply'], ticket: ['perform', 'sendMessage'] });
  assert.equal(rows[1].permission, before[1]); assert.equal(rows[2].permission, before[2]);
  assert.deepEqual(f.refreshed, ['administrator']);
  assert.deepEqual((await upgradeTicketMessagingRoles(f.db, 'org', f.options)).changed, []);
  assert.deepEqual(f.writes, ['sender', 'administrator']);
});
test('migration restores a full-access mirror on retry after interrupted refresh', async () => {
  const previous = staffAccessStatements(); previous.ticket = previous.ticket.filter(action => action !== 'sendMessage');
  const f = fixture([{ _id: 1, role: 'admin', audience: 'staff', permission: JSON.stringify(previous) }]);
  await assert.rejects(upgradeTicketMessagingRoles(f.db, 'org', { ...f.options, refreshMirrorFor: async () => { throw Error('interrupted'); } }), /interrupted/);
  await upgradeTicketMessagingRoles(f.db, 'org', f.options);
  assert.deepEqual(f.writes, ['admin']); assert.deepEqual(f.refreshed, ['admin']);
});
