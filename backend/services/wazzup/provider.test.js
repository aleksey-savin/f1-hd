const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient, normalizeAccount } = require('./provider');

test('Wazzup catalog keeps supported networks and explains account failures', () => {
  for (const [transport, type] of [['whatsapp', 'whatsapp'], ['wapi', 'whatsapp'], ['tgapi', 'telegram'], ['telegram', 'telegram'], ['max', 'max'], ['maxbot', 'max']]) {
    const account = normalizeAccount({ channelId: 'remote', transport, plainId: 'account', state: 'qr' });
    assert.equal(account.type, type);
    assert.match(account.reason, /вход|QR/);
  }
  assert.equal(normalizeAccount({ channelId: 'remote', transport: 'instagram' }), null);
});

test('provider calls fixed API endpoint with bearer secret, no redirects and a deadline', async () => {
  let request;
  const client = createClient({ fetch: async (url, options) => { request = { url, options }; return new Response(JSON.stringify([{ channelId: 'wa', transport: 'whatsapp', state: 'active' }]), { status: 200 }); } });
  const accounts = await client.fetchAccounts('secret');
  assert.equal(request.url, 'https://api.wazzup24.com/v3/channels');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.equal(request.options.redirect, 'error');
  assert.ok(request.options.signal);
  assert.equal(accounts[0].id, 'wa');
});

test('provider errors never echo keys or raw upstream details and auth failure is actionable', async () => {
  const client = createClient({ fetch: async () => new Response(JSON.stringify({ error: 'UNAUTHORIZED', description: 'key=secret' }), { status: 401 }) });
  await assert.rejects(client.fetchAccounts('secret'), error => error.statusCode === 422 && /ключ/i.test(error.message) && !JSON.stringify(error).includes('secret'));
});

test('uncertain send failure is terminal, rate rejection may wait without duplicating a message', async () => {
  const uncertain = createClient({ fetch: async () => { throw new Error('network key=secret'); } });
  await assert.rejects(uncertain.sendMessage('secret', {}), error => !error.retryable && /проверьте/i.test(error.message));
  const limited = createClient({ fetch: async () => new Response('{}', { status: 429, headers: { 'retry-after': '2' } }) });
  await assert.rejects(limited.sendMessage('secret', {}), error => error.retryable && error.retryAfterMs === 2000);
});
