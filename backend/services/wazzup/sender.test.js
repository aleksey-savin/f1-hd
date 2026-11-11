const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSender } = require('./sender');
const channel = { providerChannelId: 'remote', type: 'telegram', providerTransport: 'tgapi' };
const job = result => ({ _id: 'job', payload: { chatId: 'peer', kind: 'direct', text: 'abc', attachments: [{ name: 'a.pdf' }] }, result });
test('outbox checkpoints every accepted part and resumes without re-sending accepted text', async () => {
  const calls = [], checkpoints = [];
  const send = createSender({ send: async body => { calls.push(body); return { messageId: `remote-${calls.length}` }; }, attachmentUrl: async () => 'https://files.example/a.pdf', checkpoint: async result => checkpoints.push(structuredClone(result)) });
  const result = await send(job(), channel);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].text, 'abc');
  assert.equal(calls[0].contentUri, undefined);
  assert.equal(calls[1].text, undefined);
  assert.equal(calls[1].contentUri, 'https://files.example/a.pdf');
  assert.equal(checkpoints[0].inFlightPart, 0);
  assert.equal(checkpoints[1].inFlightPart, null);
  assert.deepEqual(result.externalIds, ['remote-1', 'remote-2']);
  calls.length = 0;
  await send(job({ nextPart: 1, inFlightPart: null, externalIds: ['already-sent'] }), channel);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].crmMessageId, 'job:1');
});
test('restart after uncertain acceptance does not resend automatically', async () => {
  const send = createSender({ send: async () => assert.fail('unsafe resend'), checkpoint: async () => {}, attachmentUrl: async () => '' });
  await assert.rejects(send(job({ nextPart: 0, inFlightPart: 0, externalIds: [] }), channel), /Результат отправки неизвестен/);
});
test('a known rate-limit rejection clears in-flight intent so the same part may retry', async () => {
  const checkpoints = [];
  const send = createSender({ send: async () => { throw Object.assign(new Error('limit'), { retryable: true }); }, checkpoint: async result => checkpoints.push(structuredClone(result)), attachmentUrl: async () => '' });
  await assert.rejects(send(job(), channel), /limit/);
  assert.equal(checkpoints.at(-1).inFlightPart, null);
  assert.equal(checkpoints.at(-1).nextPart, 0);
});

test('first Telegram/MAX contact uses phone, then resolved chatId for remaining parts and resume', async () => {
  for (const type of ['telegram', 'max']) {
    const calls = [], checkpoints = [];
    const send = createSender({ send: async body => { calls.push(body); return { messageId: `part-${calls.length}`, chatId: 'resolved-peer' }; }, attachmentUrl: async () => 'https://files.example/a.pdf', checkpoint: async value => checkpoints.push(structuredClone(value)) });
    const first = job();
    delete first.payload.chatId;
    first.payload.recipient = { phone: '79145550142' };
    const result = await send(first, { ...channel, type });
    assert.equal(calls[0].phone, '79145550142');
    assert.equal(calls[0].chatId, undefined);
    assert.equal(calls[1].chatId, 'resolved-peer');
    assert.equal(calls[1].phone, undefined);
    assert.equal(result.chatId, 'resolved-peer');
    assert.equal(checkpoints[1].chatId, 'resolved-peer');
    calls.length = 0;
    await send({ ...first, result: { nextPart: 1, inFlightPart: null, externalIds: ['part-1'], chatId: 'resolved-peer' } }, { ...channel, type });
    assert.equal(calls[0].chatId, 'resolved-peer');
    assert.equal(calls[0].phone, undefined);
  }
});

test('first WhatsApp message addresses canonical phone as chatId', async () => {
  const calls = [];
  const send = createSender({ send: async body => { calls.push(body); return { messageId: 'wa-first', chatId: '79145550142' }; }, attachmentUrl: async () => '', checkpoint: async () => {} });
  await send({ _id: 'job', payload: { recipient: { phone: '79145550142' }, text: 'Здравствуйте', kind: 'direct' } }, { ...channel, type: 'whatsapp' });
  assert.equal(calls[0].chatId, '79145550142');
  assert.equal(calls[0].phone, undefined);
});
