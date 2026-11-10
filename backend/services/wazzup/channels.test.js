require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Channel = require('../../models/channel');
const { syncChannels } = require('./channels');
test('Wazzup sync preserves local history and never disables or mutates direct channels', async t => {
  const writes = [];
  t.mock.method(Channel, 'updateMany', async (filter, update) => { writes.push({ filter, update }); });
  t.mock.method(Channel, 'findOneAndUpdate', async (filter, update) => { writes.push({ filter, update }); });
  await syncChannels({ isActive: true, channelIds: ['wa'], accounts: [{ id: 'wa', type: 'whatsapp', transport: 'whatsapp', name: 'Поддержка', account: '79145550142', state: 'active' }] });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].filter.provider, 'wazzup');
  assert.deepEqual(writes[0].filter.providerChannelId, { $nin: ['wa'] });
  assert.equal(writes[1].filter.providerChannelId, 'wa');
  assert.equal(writes[1].update.$set.state, 'connected');
  assert.equal(writes[1].update.$set['settings.markReadOnOpen'], false);
  assert.equal(writes[1].update.$set['settings.historyDays'], 0);
});
