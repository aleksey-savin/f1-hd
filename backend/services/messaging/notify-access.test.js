require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sift = require('sift').default;
const stub = (path, exports) => {
  const id = require.resolve(path), entry = new Module(id);
  Object.assign(entry, { loaded: true, exports }); require.cache[id] = entry;
};
const users = [
  { _id: 'own', rights: ['conversation.read', 'conversation.manage'], isEndUser: false },
  { _id: 'full', rights: ['conversation.readAll', 'conversation.manage'], isEndUser: false },
];
stub('@/services/permissions', { permissionFilter: async right => ({ rights: right }) });
stub('@/models/user', { find: filter => ({ select() { return this; }, lean: async () => users.filter(sift(filter)) }) });
stub('@/models/company', { findById: () => ({ select() { return this; }, lean: async () => ({ responsibles: [{ id: 'own' }] }) }) });
const { recipientsFor } = require('./notify');
test('unresolved message bells never target own-read assignees or company responsibles', async () => {
  for (const conversation of [{ assigneeId: 'own' }, { companyId: 'company' }, {}]) {
    assert.deepEqual((await recipientsFor(conversation)).map(user => user._id), ['full']);
  }
  assert.deepEqual((await recipientsFor({ assigneeId: 'full' })).map(user => user._id), ['full']);
});
