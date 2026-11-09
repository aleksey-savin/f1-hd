const { test } = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('./provider');
const settings = { token: 'secret', clientId: 'client' };
test('provider only allows import reads and the financial report method', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url: String(url), options }); return { ok: true, status: 200, json: async () => ({}) }; };
  for (const path of ['/users', '/orders/list', '/orders/info']) {
    await request(settings, path, {}, fetcher);
    assert.equal(calls.at(-1).options.method, 'GET');
    assert.equal(calls.at(-1).url, 'https://b2b-api.go.yandex.ru/integration/2.0' + path);
    await assert.rejects(request(settings, path, { method: 'POST', body: {} }, fetcher), (error) => error.statusCode === 400);
  }
  await request(settings, '/orders/taxi/report', { method: 'POST', body: { ids: ['a'] } }, fetcher);
  await assert.rejects(request(settings, '/orders/taxi/report', {}, fetcher), (error) => error.statusCode === 400);
  const before = calls.length;
  for (const path of ['/orders/create', '/orders/routestats', '/orders/cancel', '/orders/progress']) {
    await assert.rejects(request(settings, path, { method: 'POST', body: {} }, fetcher), (error) => error.statusCode === 400);
  }
  assert.equal(calls.length, before);
});
test('financial report accepts a top-level array without weakening other endpoints', async () => {
  const fetcher = async () => ({ ok: true, status: 200, json: async () => [{ id: 'a' }] });
  assert.deepEqual(await request(settings, '/orders/taxi/report', { method: 'POST', body: { ids: ['a'] } }, fetcher), [{ id: 'a' }]);
  await assert.rejects(request(settings, '/orders/info', {}, fetcher));
});
test('provider rejects malformed responses, unavailable service and HTTP errors', async () => {
  await assert.rejects(request(settings, '/orders/info', {}, async () => { throw new Error('timeout'); }), (error) => error.statusCode === 502);
  await assert.rejects(request(settings, '/orders/info', {}, async () => ({ ok: true, json: async () => null })), (error) => error.statusCode === 502);
  await assert.rejects(request(settings, '/orders/info', {}, async () => ({ ok: false, status: 403, json: async () => ({}) })), (error) => error.statusCode === 400);
});
