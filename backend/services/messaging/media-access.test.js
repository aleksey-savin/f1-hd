require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMediaAccess, signMedia, validMediaSignature } = require('./media-access');
const secret = 'test-secret-for-provider-media';

test('provider media signatures bind key and expiry and reject forged tokens', () => {
  const token = signMedia('one.png', { secret, now: 1000 });
  assert.equal(validMediaSignature('one.png', token, { secret, now: 2000 }), true);
  assert.equal(validMediaSignature('two.png', token, { secret, now: 2000 }), false);
  assert.equal(validMediaSignature('one.png', { ...token, token: '0'.repeat(64) }, { secret, now: 2000 }), false);
  assert.equal(validMediaSignature('one.png', token, { secret, now: 1000 + 86400000 }), false);
});
const auth = (actions, extra = {}) => ({ userId: 'viewer', can: request => Object.entries(request).every(([key, values]) => values.every(value => actions.includes(`${key}.${value}`))), ...extra });
const run = async ({ messages = [{ ticketId: 'ticket' }], ticket = { responsibles: [{ _id: 'viewer' }] }, viewer, query = {}, direct = false } = {}) => {
  let passed = false, status;
  const middleware = createMediaAccess({ direct, findMessages: async () => messages, findTicket: async () => ticket, attachSession: (req, res, next) => { req.auth = viewer; next(); }, ticketAccess: (value, actor) => value?.allowedUser === actor.userId, secret });
  const res = { setHeader() {}, sendStatus(code) { status = code; } };
  await middleware({ params: { name: 'one.png' }, query }, res, error => { if (error) throw error; passed = true; });
  return { passed, status };
};
test('unrelated known message attachment is private; public non-message uploads remain public', async () => {
  assert.deepEqual(await run(), { passed: false, status: 404 });
  assert.equal((await run({ messages: [] })).passed, true);
  assert.equal((await run({ viewer: auth(['conversation.read']), ticket: { responsibles: [] } })).status, 404);
  assert.equal((await run({ viewer: auth(['conversation.read']) })).passed, true);
  assert.equal((await run({ viewer: auth(['conversation.read']), ticket: { messagingReaderIds: ['viewer'] } })).passed, true);
  assert.equal((await run({ viewer: auth(['conversation.readAll']), messages: [{ ticketId: null }] })).passed, true);
});
test('ticket-only users retain their permitted ticket files; inbox scope cannot be bypassed by ticket access', async () => {
  const ticket = { allowedUser: 'viewer' };
  assert.equal((await run({ viewer: auth([]), ticket })).passed, true);
  assert.equal((await run({ viewer: auth(['conversation.read']), ticket })).status, 404);
});
test('only direct provider route accepts signed download; ordinary upload route needs session', async () => {
  const query = signMedia('one.png', { secret });
  assert.equal((await run({ query, direct: true })).passed, true);
  assert.equal((await run({ query })).status, 404);
});
test('free discussion media belongs only to its owner and stops being readable after ticket remapping', async () => {
  const message = {ticketId:null,attachMode:'free',discussionUserId:'viewer'};
  assert.equal((await run({viewer:auth(['conversation.read']),messages:[message]})).passed,true);
  assert.equal((await run({viewer:auth(['conversation.read'],{userId:'other'}),messages:[message]})).status,404);
  assert.equal((await run({viewer:auth([]),messages:[message]})).status,404);
  assert.equal((await run({viewer:auth(['conversation.read']),messages:[{...message,ticketId:'foreign',attachMode:'manual'}],ticket:{responsibles:[]}})).status,404);
});

test('source message mapping takes precedence over stale comments; orphan mirrors stay private', async () => {
  const { findMediaMessages } = require('./media-access');
  const model = rows => ({ find: () => ({ select: () => ({ lean: async () => rows }) }) });
  const moved = [{ ticketId: 'new-ticket' }];
  assert.deepEqual(await findMediaMessages('one.png', { Message: model(moved), Comment: { find: () => assert.fail('stale mirror must not grant access') } }), moved);
  const mirror = [{ ticketId: 'old-ticket' }];
  assert.deepEqual(await findMediaMessages('one.png', { Message: model([]), Comment: model(mirror) }), mirror);
});
