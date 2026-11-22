require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const loggerPath = require.resolve('../utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { log() {}, addContext: async () => ({ log() {} }) } };
const Note = require('../models/knowledgeNote');
const Preferences = require('../models/preferences');
const controller = require('./knowledgeNote');
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const userId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const call = async (handler, body = {}) => {
  let result, error;
  await handler({ params: { id }, body, auth: { userId, legacy: { userId }, can: () => true } },
    { status() { return this; }, json(value) { result = value; } }, value => { error = value; });
  return { result, error };
};
const setup = (t, fields = {}) => {
  const note = Note.hydrate({ _id: id, title: 'Reviewed', content: 'Original', __v: 2, ...fields });
  t.mock.method(Note, 'findById', async () => note);
  t.mock.method(note, 'populate', async () => note);
  t.mock.method(Preferences, 'findOne', () => ({ lean: async () => ({ knowledgeBase: {} }) }));
  return note;
};
test('approval rejects a version older than the displayed note', async t => {
  const note = setup(t);
  let saved = false;
  t.mock.method(note, 'save', async () => { saved = true; });
  const { error } = await call(controller.approve, { confirmCurrent: true, confirmNoSecrets: true, expectedVersion: 1 });
  assert.equal(error?.statusCode, 409);
  assert.equal(saved, false);
});
test('approval requires the reviewed version', async t => {
  const note = setup(t);
  t.mock.method(note, 'save', async () => {});
  const { error } = await call(controller.approve, { confirmCurrent: true, confirmNoSecrets: true });
  assert.equal(error?.statusCode, 409);
});
test('concurrent edit prevents approval at the database write', async t => {
  setup(t);
  t.mock.method(Note.collection, 'updateOne', async filter => ({ matchedCount: filter.__v === 2 ? 0 : 1, modifiedCount: 0 }));
  const { error } = await call(controller.approve, { confirmCurrent: true, confirmNoSecrets: true, expectedVersion: 2 });
  assert.equal(error?.statusCode, 409);
});
for (const action of ['confirmDeletion', 'declineDeletion', 'confirmArchive', 'declineArchive']) {
  test(`${action} rejects a note without a pending request`, async t => {
    const note = setup(t);
    t.mock.method(note, 'save', async () => {});
    t.mock.method(Note, 'deleteOne', async () => ({ deletedCount: 1 }));
    const { error } = await call(controller[action]);
    assert.equal(error?.statusCode, 409);
  });
}
test('deletion cannot remove a note changed after the moderator read it', async t => {
  setup(t, { pendingDeletion: true });
  t.mock.method(Note, 'deleteOne', async filter => ({ deletedCount: filter.pendingDeletion === true && filter.__v === 2 ? 0 : 1 }));
  const { error } = await call(controller.confirmDeletion);
  assert.equal(error?.statusCode, 409);
});
test('legacy delete submits a request instead of deleting the note', async t => {
  const note = setup(t);
  let deleted = false;
  t.mock.method(note, 'save', async () => {});
  t.mock.method(Note, 'deleteOne', async () => { deleted = true; });
  await call(controller.delete);
  assert.equal(deleted, false);
  assert.equal(note.pendingDeletion, true);
});

test('current reviewed version can be approved and advances the version', async t => {
  const note = setup(t);
  let persisted;
  t.mock.method(Note.collection, 'updateOne', async (filter, update) => {
    assert.equal(filter.__v, 2);
    persisted = update;
    return { matchedCount: 1, modifiedCount: 1 };
  });
  const { result, error } = await call(controller.approve, { confirmCurrent: true, confirmNoSecrets: true, expectedVersion: 2 });
  assert.equal(error, undefined);
  assert.equal(result.note.approved, true);
  assert.equal(persisted.$inc.__v, 1);
  assert.equal(note.__v, 3);
});

test('bulk approval skips stale reviewed versions without writing', async t => {
  const note = setup(t);
  t.mock.method(Note, 'find', async () => [note]);
  let saved = false;
  t.mock.method(note, 'save', async () => { saved = true; });
  const { result, error } = await call(controller.approveMultiple, {
    ids: [id], confirmCurrent: true, confirmNoSecrets: true, expectedVersions: { [id]: 1 },
  });
  assert.equal(error, undefined);
  assert.equal(result.processed, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(saved, false);
});

test('bulk archive skips requests changed at the database write', async t => {
  const note = setup(t, { pendingArchive: true });
  t.mock.method(Note, 'find', async () => [note]);
  t.mock.method(Note.collection, 'updateOne', async filter => ({ matchedCount: filter.__v === 2 ? 0 : 1 }));
  const { result, error } = await call(controller.confirmArchiveMultiple, { ids: [id] });
  assert.equal(error, undefined);
  assert.equal(result.processed, 0);
  assert.equal(result.skipped.length, 1);
});

test('legacy notes without a version still use a conditional approval write', async t => {
  setup(t, { __v: undefined });
  let filter;
  t.mock.method(Note.collection, 'updateOne', async value => {
    filter = value;
    return { matchedCount: 1, modifiedCount: 1 };
  });
  const { error } = await call(controller.approve, { confirmCurrent: true, confirmNoSecrets: true, expectedVersion: 0 });
  assert.equal(error, undefined);
  assert.deepEqual(filter.__v, { $exists: false });
});
