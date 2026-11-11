require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
require('./counter').findById = async () => ({ seq: 1 });
const { Ticket } = require('./ticket');
const id = () => new mongoose.Types.ObjectId();
const retain = async ticket => {
  const hook = Ticket.schema.s.hooks._pres.get('save').find(h => h.fn.name === 'retainMessagingReaders');
  assert.ok(hook, 'durable responsibility history hook exists');
  await hook.fn.call(ticket);
};
test('replacement retains original and new responsible IDs in the same atomic save', async () => {
  const a = id(), b = id();
  const ticket = Ticket.hydrate({ _id: id(), responsibles: [{ _id: a }], messagingReaderIds: [] });
  ticket.responsibles = [{ _id: b }];
  await retain(ticket);
  assert.deepEqual(ticket.messagingReaderIds.map(String).sort(), [a,b].map(String).sort());
  assert.deepEqual(ticket.$getChanges().$addToSet.messagingReaderIds.$each.map(String).sort(), [a,b].map(String).sort());
});
test('notification queue cleanup cannot remove historical readers', async () => {
  const a = id();
  const ticket = Ticket.hydrate({ _id: id(), responsibles: [], messagingReaderIds: [a], removedFromResponsibles: [{ _id: a }] });
  ticket.removedFromResponsibles = [];
  await retain(ticket);
  assert.deepEqual(ticket.messagingReaderIds.map(String), [String(a)]);
});
test('a projected assignment change cannot overwrite unselected history', async () => {
  const a = id(), b = id();
  const ticket = Ticket.hydrate({ _id: id(), responsibles: [{ _id: a }] }, { responsibles: 1 });
  ticket.responsibles = [{ _id: b }];
  await assert.rejects(retain(ticket), /Load messagingReaderIds/);
});
