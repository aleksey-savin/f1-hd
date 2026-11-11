import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketMessagingAccess } from './ticket-messaging-access.js';

const access = (actions, extra = {}) => ticketMessagingAccess({ moduleOn: true, isEndUser: false, can: request => Object.entries(request).every(([resource, verbs]) => verbs.every(verb => actions.includes(`${resource}.${verb}`))), ...extra });
test('ticket-only messenger permission enables reply routes without opening inbox links', () => {
  assert.deepEqual(access(['ticket.sendMessage']), { routesEnabled: true, canReply: true, canOpenConversation: false });
});
test('inbox read and reply do not grant ticket sending; read still permits dialog context', () => {
  assert.deepEqual(access(['conversation.read', 'conversation.reply']), { routesEnabled: true, canReply: false, canOpenConversation: true });
});
test('clients and disabled module cannot use staff messenger features', () => {
  const disabled = { routesEnabled: false, canReply: false, canOpenConversation: false };
  assert.deepEqual(access(['ticket.sendMessage', 'conversation.read'], { isEndUser: true }), disabled);
  assert.deepEqual(access(['ticket.sendMessage', 'conversation.read'], { moduleOn: false }), disabled);
});
