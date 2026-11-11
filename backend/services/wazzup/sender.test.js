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

test('native quote reference is sent on every text and media part for each supported network', async () => {
  for (const type of ['telegram', 'whatsapp', 'max']) {
    for (const kind of ['direct', 'group']) {
      const calls = [];
      const quoted = job();
      quoted.payload.kind = kind;
      quoted.payload.text = 'x'.repeat(10_001);
      quoted.payload.replyToExternalId = 'wazzup-original-message';
      quoted.payload.attachments.push({ name: 'b.pdf' });
      const send = createSender({
        send: async body => { calls.push(body); return { messageId: `part-${calls.length}` }; },
        attachmentUrl: async attachment => `https://files.example/${attachment.name}`,
        checkpoint: async () => {},
      });
      await send(quoted, { ...channel, type });
      assert.ok(calls.filter(body => body.text).length > 1);
      assert.equal(calls.filter(body => body.contentUri).length, 2);
      for (const [index, body] of calls.entries()) {
        assert.equal(body.refMessageId, 'wazzup-original-message', `${type}/${kind}: part ${index} lost its native quote`);
        assert.equal(body.replyToExternalId, undefined, 'internal field must map to the v3 provider field');
        assert.equal(body.crmMessageId, `job:${index}`);
        assert.equal(body.chatType, kind === 'group' ? { telegram: 'telegroup', whatsapp: 'whatsgroup', max: 'maxgroup' }[type] : type);
      }
    }
  }
});

test('old queued payloads omit the provider quote field entirely', async () => {
  const calls = [];
  const send = createSender({ send: async body => { calls.push(body); return { messageId: `part-${calls.length}` }; }, attachmentUrl: async () => 'https://files.example/a.pdf', checkpoint: async () => {} });
  await send(job(), channel);
  assert.ok(calls.every(body => !Object.hasOwn(body, 'refMessageId')));
});

test('retry resumes the rejected quoted attachment without resending accepted text', async () => {
  const calls = [], checkpoints = [];
  const quoted = job();
  quoted.payload.replyToExternalId = 'original';
  const rateLimit = Object.assign(new Error('limit'), { retryable: true });
  let rejectAttachment = true;
  const send = createSender({
    send: async body => {
      calls.push(body);
      if (body.contentUri && rejectAttachment) { rejectAttachment = false; throw rateLimit; }
      return { messageId: body.text ? 'accepted-text' : 'accepted-file' };
    },
    attachmentUrl: async () => 'https://files.example/a.pdf',
    checkpoint: async result => checkpoints.push(structuredClone(result)),
  });
  await assert.rejects(send(quoted, channel), error => error === rateLimit);
  assert.equal(checkpoints.at(-1).nextPart, 1);
  assert.deepEqual(checkpoints.at(-1).externalIds, ['accepted-text']);
  assert.equal(checkpoints.at(-1).inFlightPart, null);
  const result = await send({ ...quoted, result: checkpoints.at(-1) }, channel);
  assert.deepEqual(calls.map(body => body.crmMessageId), ['job:0', 'job:1', 'job:1']);
  assert.equal(calls.filter(body => body.text).length, 1);
  assert.ok(calls.every(body => body.refMessageId === 'original'));
  assert.deepEqual(result.externalIds, ['accepted-text', 'accepted-file']);
});

test('provider quote rejection surfaces without an unquoted fallback or attachment send', async () => {
  const calls = [], checkpoints = [];
  const quoted = job();
  quoted.payload.replyToExternalId = 'deleted-original';
  const rejected = Object.assign(new Error('Reference message not found'), { code: 'REFERENCE_MESSAGE_NOT_FOUND', retryable: false });
  const send = createSender({
    send: async body => { calls.push(body); throw rejected; },
    attachmentUrl: async () => assert.fail('must stop after rejected text'),
    checkpoint: async result => checkpoints.push(structuredClone(result)),
  });
  await assert.rejects(send(quoted, channel), error => error === rejected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].refMessageId, 'deleted-original');
  assert.equal(checkpoints.length, 1, 'no successful part is checkpointed');
  assert.deepEqual(checkpoints[0].externalIds, []);
});
