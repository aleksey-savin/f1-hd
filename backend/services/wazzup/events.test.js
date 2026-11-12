const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMessage, channelState, eventKey, splitText, sendParts, mediaUrl } = require('./events');
const channel = { _id: '64f600000000000000000001', type: 'telegram', providerChannelId: 'remote', providerTransport: 'tgapi' };
const incoming = { channelId: 'remote', messageId: 'msg-1', chatType: 'telegram', chatId: 'opaque', dateTime: '2026-11-10T01:00:00Z', isEcho: false, type: 'text', text: 'Привет', contact: { name: 'Марина', phone: '79145550142' } };
test('Wazzup Telegram identifiers are scoped to provider and never match native bot ids', () => {
  const event = normalizeMessage(incoming, channel);
  assert.equal(event.chat.peer.id, 'wazzup:remote:opaque');
  assert.equal(event.message.sender.phone, '79145550142');
  assert.equal(event.message.direction, 'in');
  assert.equal(event.chat.id, 'opaque');
});
test('different networks and malformed payloads are rejected at normalization boundary', () => {
  assert.equal(normalizeMessage({ ...incoming, chatType: 'whatsapp' }, channel), null);
  assert.equal(normalizeMessage({ ...incoming, dateTime: 'garbage' }, channel), null);
  assert.equal(normalizeMessage({ ...incoming, isEcho: 'false' }, channel), null);
});
test('outbound echoes correlate to existing HD jobs and edits cannot rewrite signed own text', () => {
  const own = { jobId: '64f600000000000000000002', origin: 'hd' };
  const echo = normalizeMessage({ ...incoming, isEcho: true }, channel, { own });
  assert.equal(echo.message.origin, 'hd');
  assert.equal(echo.message.jobId, own.jobId);
  assert.equal(normalizeMessage({ ...incoming, isEcho: true, isEdited: true }, channel, { own }), null);
});
test('deletions preserve messenger semantics', () => {
  assert.equal(normalizeMessage({ ...incoming, isDeleted: true }, channel).type, 'message.deleted');
});
test('v3 group metadata and CRM author fields never identify an incoming participant', () => {
  for (const [type, chatType] of [['telegram', 'telegroup'], ['whatsapp', 'whatsgroup'], ['max', 'maxgroup']]) {
    const event = normalizeMessage({ ...incoming, chatType, contact: { name: 'Группа', phone: '79145550142', username: 'group' }, authorId: 'crm-user', authorName: 'Сотрудник' }, { ...channel, type });
    assert.equal(event.chat.kind, 'group');
    assert.equal(event.chat.title, 'Группа');
    assert.equal(event.chat.peer, undefined);
    assert.equal(event.message.sender, null);
    const checked = require('../messaging/events').validateEvent(event);
    assert.equal(checked.ok, true);
    assert.equal(checked.event.message.sender, null);
  }
});
test('event dedup key is insensitive to object key order but includes edits', () => {
  assert.equal(eventKey('messages', { a: 1, b: 2 }), eventKey('messages', { b: 2, a: 1 }));
  assert.notEqual(eventKey('messages', incoming), eventKey('messages', { ...incoming, text: 'Правка' }));
});
test('state descriptions drive connected, logout and billing errors without direct login UI', () => {
  assert.equal(channelState('active').state, 'connected');
  assert.equal(channelState('qr').state, 'loggedOut');
  assert.match(channelState('notEnoughMoney').reason, /оплат/i);
});
test('text splitting preserves Unicode and outbox parts never mix text with a file', () => {
  const text = '😀'.repeat(4097);
  const chunks = splitText(text, 4096);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(part => part.length <= 4096 && !/[\uD800-\uDBFF]$/.test(part)));
  const parts = sendParts({ text: 'abc', attachments: [{ name: 'file', originalName: 'a.pdf' }] }, channel);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text, 'abc');
  assert.equal(parts[1].attachment.name, 'file');
});
test('inbound media only downloads from Wazzup HTTPS storage without credentials', () => {
  assert.ok(mediaUrl('https://store.wazzup24.com/abc?filename=a.pdf'));
  for (const url of ['http://store.wazzup24.com/a', 'https://127.0.0.1/a', 'https://store.wazzup24.com.evil.test/a', 'https://user:pass@store.wazzup24.com/a']) assert.equal(mediaUrl(url), null);
});
