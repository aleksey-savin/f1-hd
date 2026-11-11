require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const stub = (name, exports) => { const id = require.resolve(name), entry = new Module(id); Object.assign(entry, { loaded: true, exports }); require.cache[id] = entry; };
stub('@/controllers/conversation', new Proxy({}, { get: (_target, name) => (_req, res) => res.json({ handler: name }) }));
stub('@/controllers/messagingSticker', new Proxy({}, { get: (_target, name) => (_req, res) => res.json({ handler: name }) }));
stub('@/controllers/channel', new Proxy({}, { get: (_target, name) => (_req, res) => res.json({ handler: name }) }));
stub('@/middleware/fileUpload', { array: () => (_req, _res, next) => next() });
stub('@/services/ticketAccess', { loadAccessibleTicket: async (_auth, { num }) => { if (num === '42') return { _id: 'ticket', num: 42 }; throw Object.assign(Error('Ticket unavailable'), { statusCode: 404 }); } });
stub('@/middleware/modules', { messagingModuleIsActive: (_req, _res, next) => next() });
const router = require('./conversation');
const check = async (actions, path, method = 'GET') => {
  const app = express();
  app.use((req, _res, next) => { req.auth = { userId: 'staff', can: request => Object.entries(request).every(([resource, verbs]) => verbs.every(verb => actions.includes(`${resource}.${verb}`))) }; next(); });
  app.use(router);
  app.use((error, _req, res, _next) => res.sendStatus(error.statusCode || 500));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { return await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method }); }
  finally { server.close(); }
};

test('ticket send permission permits route lookup and retry but denies inbox/read/new-dialog APIs', async () => {
  const actions = ['ticket.sendMessage'];
  assert.equal((await check(actions, '/tickets/42/delivery-routes')).status, 200);
  assert.equal((await check(actions, '/messages/message/retry', 'POST')).status, 200);
  assert.equal((await check(actions, '/tickets/43/delivery-routes')).status, 404);
  for (const path of ['/conversations', '/conversations/counts', '/conversations/chat', '/conversations/chat/messages', '/conversations/recipients?q=test', '/conversations/start-routes?phone=79145550142', '/conversations/outgoing/message']) {
    assert.equal((await check(actions, path)).status, 403, path);
  }
  assert.equal((await check(actions, '/conversations/start', 'POST')).status, 403);
  assert.equal((await check(actions, '/conversations/chat/messages', 'POST')).status, 403);
});
test('new-dialog APIs require both inbox read and reply; an unprivileged user cannot retry', async () => {
  assert.equal((await check(['conversation.read'], '/conversations/recipients?q=test')).status, 403);
  assert.equal((await check(['conversation.reply'], '/conversations/recipients?q=test')).status, 403);
  const response = await check(['conversation.read', 'conversation.reply', 'conversation.start'], '/conversations/recipients?q=test');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).handler, 'startRecipients');
  assert.equal((await check([], '/messages/message/retry', 'POST')).status, 403);
  assert.equal((await check([], '/tickets/42/delivery-routes')).status, 403);
});

test('corporate sticker management requires settings permission', async () => {
 for(const actions of [[],['conversation.read'],['conversation.reply'],['ticket.sendMessage']]) {
  assert.equal((await check(actions,'/conversation-stickers','POST')).status,403);
  assert.equal((await check(actions,'/conversation-stickers/import','POST')).status,403);
  assert.equal((await check(actions,'/conversation-stickers/64f600000000000000000001','DELETE')).status,403);
  assert.equal((await check(actions,'/settings/conversation-stickers')).status,403);
 }
 assert.equal((await check([], '/conversation-stickers')).status,403);
});

test('settings-only admin can inspect the shared pack without inbox access', async () => {
 assert.equal((await check(['settings.manage'], '/settings/conversation-stickers')).status,200);
 assert.equal((await check(['settings.manage'], '/conversation-stickers')).status,403);
 assert.equal((await check(['conversation.read'], '/conversation-stickers')).status,200);
});

test('ticket-only sender can read stickers only for an accessible ticket',async()=>{
 assert.equal((await check(['ticket.sendMessage'],'/tickets/42/stickers')).status,200);
 assert.equal((await check(['ticket.sendMessage'],'/tickets/43/stickers')).status,404);
 assert.equal((await check([],'/tickets/42/stickers')).status,403);
 assert.equal((await check(['ticket.sendMessage'],'/conversation-stickers')).status,403);
});

test('inbox action boundaries are independent from ticket access', async () => {
 assert.equal((await check(['conversation.readAll'], '/conversations')).status, 200);
 assert.equal((await check(['conversation.reply'], '/conversations/chat/messages', 'POST')).status, 403);
 assert.equal((await check(['conversation.manage'], '/conversations/chat/hide', 'POST')).status, 403);
 assert.equal((await check(['conversation.manage','conversation.readAll'], '/conversations/chat/hide', 'POST')).status, 200);
 assert.equal((await check(['conversation.read','conversation.reply'], '/conversations/start', 'POST')).status, 403);
 assert.equal((await check(['conversation.readAll','conversation.reply','conversation.start'], '/conversations/recipients')).status, 200);
});

test('handled triage requires manage and readAll without requiring reply',async()=>{
 assert.equal((await check(['conversation.readAll','conversation.reply'],'/conversations/chat/handled','POST')).status,403);
 assert.equal((await check(['conversation.read','conversation.manage'],'/conversations/chat/handled','POST')).status,403);
 assert.equal((await check(['conversation.readAll','conversation.manage'],'/conversations/chat/handled','POST')).status,200);
});
