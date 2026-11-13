import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationReplyAllowed, CONVERSATION_READ_ACCESS } from './conversation-access.js';

test('inbox entry accepts own or all reading independently', () => {
  assert.deepEqual(CONVERSATION_READ_ACCESS, { conversation: { actions: ['read', 'readAll'], connector: 'OR' } });
});
test('sending follows server capabilities and current ticket permission', () => {
  const restricted = { access: { reply: true, all: false }, tickets: [{ id: 'own', canReply: true }, { id: 'former', canReply: false }] };
  assert.equal(conversationReplyAllowed(restricted, { mode: 'ticket', ticket: { id: 'own' } }), true);
  assert.equal(conversationReplyAllowed(restricted, { mode: 'ticket', ticket: { id: 'former', canReply: true } }), false);
  assert.equal(conversationReplyAllowed(restricted, { mode: 'free' }), false);
  assert.equal(conversationReplyAllowed({ ...restricted, access: { reply: false, all: true } }, { mode: 'free' }), false);
  assert.equal(conversationReplyAllowed({ access: { reply: true, all: true } }, { mode: 'free' }), true);
  assert.equal(conversationReplyAllowed({}, { mode: 'free' }), false);
});
test('server may allow personal free replies independently of global history access', () => {
  const card={access:{reply:true,all:false,freeReply:true}};
  assert.equal(conversationReplyAllowed(card,{mode:'free'}),true);
  assert.equal(conversationReplyAllowed({...card,access:{...card.access,reply:false}},{mode:'free'}),false);
});
