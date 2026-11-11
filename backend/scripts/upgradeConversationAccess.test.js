const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planRole, memberNeedsGlobalRead } = require('./upgradeConversationAccess');
test('only old global readers retain global access; senders retain start', () => {
  assert.deepEqual(planRole({ conversation: ['read', 'reply'], ticket: ['readAll'] }).conversation, ['read', 'reply', 'readAll', 'start']);
  assert.deepEqual(planRole({ conversation: ['read', 'reply'], ticket: ['readCompany'] }).conversation, ['read', 'reply', 'start']);
  assert.deepEqual(planRole({ conversation: ['manage'] }).conversation, ['manage']);
});
test('effective split roles qualify only their joint holder', () => {
  const roles = new Map([['reader', { conversation: ['read'] }], ['tickets', { ticket: ['readAll'] }]]);
  assert.equal(memberNeedsGlobalRead('reader,tickets', roles), true);
  assert.equal(memberNeedsGlobalRead('reader', roles), false);
  assert.equal(memberNeedsGlobalRead('tickets', roles), false);
});
test('role upgrade is idempotent', () => {
  const next = planRole({ conversation: ['read', 'reply'], ticket: ['readAll'] });
  assert.deepEqual(planRole(next), next);
});
test('migration assigns split-role readers narrowly and can resume after mirror failure', async () => {
  const { upgradeConversationAccess } = require('./upgradeConversationAccess');
  const rows = [
    { _id: 'r', role: 'reader', permission: JSON.stringify({ conversation: ['read', 'reply'] }) },
    { _id: 't', role: 'tickets', permission: JSON.stringify({ ticket: ['readAll'] }) },
    { _id: 'c', role: 'client', audience: 'client', permission: JSON.stringify({ conversation: ['read', 'reply'], ticket: ['readAll'] }) },
  ];
  const members = [{ _id: 'both', role: 'reader,tickets' }, { _id: 'restricted', role: 'reader' }, { _id: 'client', role: 'client' }];
  const writes = [];
  const collection = list => ({
    find: () => ({ toArray: async () => list.map(row => ({ ...row })) }),
    updateOne: async (filter, update, options) => {
      let row = list.find(row => Object.entries(filter).every(([key, value]) => key === 'organizationId' || row[key] === value));
      if (!row && options?.upsert) { row = { ...update.$setOnInsert }; list.push(row); writes.push('insert'); }
      if (!row) return { matchedCount: 0 };
      if (update.$set) { Object.assign(row, update.$set); writes.push('update'); }
      return { matchedCount: 1 };
    },
  });
  let backfills = 0;
  const db = { collection: name => name === 'organizationRole' ? collection(rows) : name === 'member' ? collection(members) : { updateMany: async (_filter, pipeline) => { assert.ok(pipeline[0].$set.messagingReaderIds.$setUnion); backfills++; }, createIndex: async () => {} } };
  await upgradeConversationAccess(db, 'org');
  assert.equal(writes.length, 0); assert.equal(backfills, 0);
  await assert.rejects(upgradeConversationAccess(db, 'org', { apply: true, refreshMirrorFor: async () => { throw Error('interrupted'); } }), /interrupted/);
  assert.equal(members[0].role, 'reader,tickets,conversation-global-read-migrated');
  assert.equal(members[1].role, 'reader'); assert.equal(members[2].role, 'client');
  assert.deepEqual(JSON.parse(rows[0].permission).conversation, ['read', 'reply', 'start']);
  const count = writes.length;
  const refreshed = [];
  await upgradeConversationAccess(db, 'org', { apply: true, refreshMirrorFor: async (_org, key) => refreshed.push(key) });
  assert.equal(writes.length, count);
  assert.ok(refreshed.includes('conversation-global-read-migrated'));
});
