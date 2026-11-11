require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sift = require('sift').default;
const { canReadInbox, readsAll, canReadTicketMessages, canReplyToTicket, ownTicketFilter, messageFilter } = require('./access');
const ME = '64f100000000000000000001', OTHER = '64f100000000000000000002';
const auth = (...rights) => ({ userId: ME, can: request => Object.entries(request).every(([resource, actions]) => actions.every(action => rights.includes(`${resource}.${action}`))) });
test('readAll alone opens the inbox independently of ticket permissions', () => {
  assert.equal(canReadInbox(auth('conversation.readAll')), true);
  assert.equal(readsAll(auth('ticket.readAll')), false);
  assert.equal(canReadInbox(auth('conversation.reply')), false);
});
test('current and former responsibility allow reading; creator and company do not', () => {
  const viewer = auth('conversation.read', 'ticket.readAll');
  for (const ticket of [{responsibles:[{_id:ME}]}, {messagingReaderIds:[ME]}]) assert.equal(canReadTicketMessages(ticket, viewer), true);
  assert.equal(canReadTicketMessages({createdBy:ME, responsibles:[{_id:OTHER}]}, viewer), false);
  assert.equal(canReadTicketMessages({deletedAt:new Date(), messagingReaderIds:[ME]}, viewer), false);
});
test('former responsibility and closed tickets never grant reply context', () => {
  const viewer = auth('conversation.read', 'conversation.reply', 'ticket.sendMessage');
  assert.equal(canReplyToTicket({responsibles:[{_id:ME}]}, viewer), true);
  assert.equal(canReplyToTicket({messagingReaderIds:[ME]}, viewer), false);
  assert.equal(canReplyToTicket({responsibles:[{_id:ME}],isClosed:true}, viewer), false);
});
test('database filter agrees with responsibility rule and ignores ticket.readAll', () => {
  const viewer = auth('conversation.read','ticket.readAll');
  const matches = sift(JSON.parse(JSON.stringify(ownTicketFilter(viewer))));
  assert.equal(matches({responsibles:[{_id:ME}]}), true);
  assert.equal(matches({messagingReaderIds:[ME]}), true);
  assert.equal(matches({createdBy:ME}), false);
});
test('message scope excludes unrelated and unassigned messages even in an accessible chat', () => {
  const viewer = {...auth('conversation.read'), messagingScope:{ticketIds:[ME],conversationIds:[]}};
  const matches = sift(JSON.parse(JSON.stringify(messageFilter(viewer))));
  assert.equal(matches({ticketId:ME}), true);
  assert.equal(matches({ticketId:OTHER}), false);
  assert.equal(matches({ticketId:null}), false);
  assert.deepEqual(messageFilter(auth('conversation.readAll')), {});
});
