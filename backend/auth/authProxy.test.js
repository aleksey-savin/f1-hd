const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { fixture, PASSWORD, ORIGIN, cookieFrom } = require('./__tests__/browserSession.fixture.cjs');
const { AUTH_IP_HEADER, parseTrustProxyHops } = require('../services/authRatePolicy');

async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (path, headers = {}, body = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

test('Express hops 2 overwrites forged auth/forwarding identity before installed better-auth IP reader', async (t) => {
  const f = await fixture();
  const { getIp } = await import('better-auth/api');
  const { toNodeHandler } = await import('./instance.mjs');
  const app = express();
  app.set('trust proxy', parseTrustProxyHops('2'));
  app.post('/probe', toNodeHandler({ handler: async (request) => Response.json({ ip: getIp(request, f.ctx.options) }) }));
  const send = await serve(t, app);
  for (const ip of ['198.51.100.10', '198.51.100.11']) {
    const response = await send('/probe', { 'x-forwarded-for': `1.2.3.4, ${ip}, 10.0.0.2`, 'x-real-ip': '4.3.2.1', [AUTH_IP_HEADER]: '8.8.8.8' });
    assert.deepEqual(await response.json(), { ip });
  }
  app.set('trust proxy', parseTrustProxyHops('1'));
  assert.deepEqual(await (await send('/probe', { 'x-forwarded-for': '8.8.8.8, 198.51.100.12' })).json(), { ip: '198.51.100.12' });
  app.set('trust proxy', parseTrustProxyHops('0'));
  assert.deepEqual(await (await send('/probe', { 'x-forwarded-for': '8.8.8.8', [AUTH_IP_HEADER]: '8.8.8.8' })).json(), { ip: '127.0.0.1' });
});

test('raw TOTP uses authenticated session budgets, not a global library bucket for unrelated NAT clients', async (t) => {
  const f = await fixture();
  const { toNodeHandler } = await import('./instance.mjs');
  const { authPathAllowList } = require('../middleware/authPathAllowList');
  const app = express();
  app.set('trust proxy', 2);
  app.all('/api/auth/{*path}', authPathAllowList, toNodeHandler(f.auth));
  const send = await serve(t, app);
  const headers = { 'x-forwarded-for': '198.51.100.21, 10.0.0.2' };
  for (let i = 0; i < 6; i++) {
    const cookie = cookieFrom(await f.login());
    const response = await send('/api/auth/two-factor/verify-totp', { ...headers, cookie }, { code: '000000' });
    assert.notEqual(response.status, 429);
  }
  const attacked = cookieFrom(await f.login());
  for (let i = 0; i < 30; i++) {
    const response = await send('/api/auth/two-factor/verify-totp', { ...headers, cookie: attacked }, { code: '000000' });
    assert.notEqual(response.status, 429);
  }
  assert.equal((await send('/api/auth/two-factor/verify-totp', { ...headers, cookie: attacked }, { code: '000000' })).status, 429);
  assert.notEqual((await send('/api/auth/two-factor/verify-totp', { ...headers, cookie: cookieFrom(await f.login()) }, { code: '000000' })).status, 429);
  assert.equal((await send('/api/auth/sign-in/email', headers, { email: f.user.email, password: PASSWORD })).status, 404);
});

test('raw reset-password failure budget cannot be bypassed by forged internal/forwarding prefix', async (t) => {
  const f = await fixture();
  const { toNodeHandler } = await import('./instance.mjs');
  const app = express();
  app.set('trust proxy', 2);
  app.all('/api/auth/{*path}', toNodeHandler(f.auth));
  const send = await serve(t, app);
  for (let i = 0; i < 10; i++) {
    const response = await send('/api/auth/reset-password', { 'x-forwarded-for': `${i}.1.1.1, 198.51.100.22, 10.0.0.2`, [AUTH_IP_HEADER]: `${i}.2.2.2` }, { token: 'invalid-reset', newPassword: PASSWORD });
    assert.notEqual(response.status, 429);
  }
  assert.equal((await send('/api/auth/reset-password', { 'x-forwarded-for': '198.51.100.22, 10.0.0.2' }, { token: 'invalid-reset', newPassword: PASSWORD })).status, 429);
  assert.notEqual((await send('/api/auth/reset-password', { 'x-forwarded-for': '198.51.100.23, 10.0.0.2' }, { token: 'other-reset', newPassword: PASSWORD })).status, 429);
});
test('raw reset IP budget limits rotating token keys', async (t) => {
  const f = await fixture();
  const { toNodeHandler } = await import('./instance.mjs');
  const app = express(); app.set('trust proxy', 2);
  app.all('/api/auth/{*path}', toNodeHandler(f.auth));
  const send = await serve(t, app);
  for (let i = 0; i < 50; i++) {
    assert.notEqual((await send('/api/auth/reset-password', { 'x-forwarded-for': '198.51.100.24, 10.0.0.2' }, { token: `rotated-${i}`, newPassword: PASSWORD })).status, 429);
  }
  assert.equal((await send('/api/auth/reset-password', { 'x-forwarded-for': '198.51.100.24, 10.0.0.2' }, { token: 'fresh-token', newPassword: PASSWORD })).status, 429);
});

test('stable Task4 raw-body bridge preserves canonical Express IP through real bootstrap dispatch', async (t) => {
  require('module-alias/register');
  const mongoose = require('mongoose');
  const config = require('./config');
  const bootstrap = require('./bootstrap');
  const { getIp } = await import('better-auth/api');
  const { authBodyLimit } = require('../middleware/authBodyLimit');
  const { authPathAllowList } = require('../middleware/authPathAllowList');
  const { browserOrigin } = require('../middleware/browserOrigin');
  const hooksId = require.resolve('./hooks');
  const previousHooks = require.cache[hooksId];
  require.cache[hooksId] = { id: hooksId, filename: hooksId, loaded: true, exports: {} };
  t.after(() => { if (previousHooks) require.cache[hooksId] = previousHooks; else delete require.cache[hooksId]; });
  t.mock.property(config, 'baseURL', ORIGIN);
  t.mock.property(config, 'secret', 'proxy-test-only-secret-of-at-least-32-characters');
  const previousDb = Object.getOwnPropertyDescriptor(mongoose.connection, 'db');
  const previousReady = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  mongoose.connection.db = { collection: () => ({}) };
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, value: 1 });
  t.after(() => {
    if (previousDb) Object.defineProperty(mongoose.connection, 'db', previousDb); else delete mongoose.connection.db;
    if (previousReady) Object.defineProperty(mongoose.connection, 'readyState', previousReady); else delete mongoose.connection.readyState;
  });
  t.mock.method(mongoose.connection, 'getClient', () => ({}));
  const auth = await bootstrap.initAuth();
  const ctx = await auth.$context;
  // Only this diagnostic endpoint is replaced; dispatch, bounded body replay,
  // Node adapter and the installed IP reader are all the production ones.
  t.mock.method(auth, 'handler', async (request) => Response.json({ ip: getIp(request, ctx.options), body: await request.json() }));
  const app = express(); app.set('trust proxy', parseTrustProxyHops('2'));
  app.all('/api/auth/{*path}', authPathAllowList, browserOrigin({ publicUrl: ORIGIN }), authBodyLimit(), bootstrap.authRequestHandler);
  const send = await serve(t, app);
  for (const ip of ['198.51.100.81', '198.51.100.82']) {
    const response = await send('/api/auth/reset-password', { 'x-forwarded-for': `1.2.3.4, ${ip}, 10.0.0.2`, [AUTH_IP_HEADER]: '8.8.8.8' }, { token: 'body-is-intact' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ip, body: { token: 'body-is-intact' } });
  }
});
