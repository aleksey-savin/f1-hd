require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Module = require('node:module');
const { fixture, PASSWORD, ORIGIN, cookieFrom } = require('../auth/__tests__/browserSession.fixture.cjs');
const { authRatePolicy, AUTH_IP_HEADER } = require('../services/authRatePolicy');
let current;
const query = (filter) => {
  const p = Promise.resolve(filter?.email && filter.email !== current.user.email ? null : current.user);
  p.select = () => p; p.lean = () => p; return p;
};
function stub(path, exports) {
  const id = require.resolve(path); const entry = new Module(id);
  Object.assign(entry, { filename: id, loaded: true, exports }); require.cache[id] = entry;
}
stub('../models/user', { findOne: query, findById: query });
stub('../models/preferences', { findOne: async () => null });
stub('../auth/bootstrap', { getAuth: () => current.auth, getFromNodeHeaders: () => (headers) => new Headers(headers) });
stub('../services/telegramActor', {});
stub('../controllers/impersonation', { claim: (_req, res) => res.sendStatus(401) });
stub('../utils/logger', { logDirect: () => {} });
const controller = require('./auth');
const router = require('../routes/internal/auth');
async function harness(t) {
  current = await fixture();
  current.user = { ...current.user, _id: current.user.id, isEndUser: true, save: async () => {} };
  authRatePolicy.credentialSuccess(current.user.email);
  const app = express(); app.set('trust proxy', 2); app.use(express.json());
  app.post('/password-direct', controller.login);
  app.use('/api', router);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const send = (path, body, ip = '198.51.100.30', headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': `8.8.8.8, ${ip}, 10.0.0.2`, [AUTH_IP_HEADER]: '8.8.4.4', ...headers }, body: JSON.stringify(body),
  });
  return { ...current, send };
}

test('unknown and known wrong passwords have generic errors; unknown does real dummy verification and issues no session', async (t) => {
  const f = await harness(t);
  let calls = 0;
  const verify = f.ctx.password.verify;
  t.mock.method(f.ctx.password, 'verify', async (args) => { calls++; return verify(args); });
  const unknown = await f.send('/password-direct', { email: 'unknown-controller@example.test', password: PASSWORD });
  const known = await f.send('/password-direct', { email: f.user.email, password: 'incorrect-password' });
  assert.equal(unknown.status, 401); assert.equal(known.status, 401);
  assert.deepEqual(await unknown.json(), await known.json());
  assert.equal(calls, 2);
  assert.equal(f.data.authSessions.length, 0);
});

test('attacker-induced account cooldown does not refuse verified password and preserves an active session', async (t) => {
  const f = await harness(t);
  const existing = await f.login(); const cookie = cookieFrom(existing);
  await f.send('/api/login', { email: f.user.email, password: 'wrong' }, '198.51.100.31');
  const deadline = authRatePolicy.cooldown(f.user.email).resetAt;
  const retry = await f.send('/api/login', { email: f.user.email, password: 'wrong' }, '198.51.100.32');
  assert.equal(retry.status, 429);
  assert.equal(authRatePolicy.cooldown(f.user.email).resetAt, deadline);
  const direct = await f.send('/password-direct', { email: ` ${f.user.email.toUpperCase()} `, password: PASSWORD }, '198.51.100.33');
  assert.equal(direct.status, 200);
  assert.equal((await f.send('/api/login', { email: f.user.email.toUpperCase(), password: PASSWORD }, '198.51.100.34')).status, 200);
  assert.equal(authRatePolicy.cooldown(f.user.email).allowed, true);
  assert.ok(await f.auth.api.getSession({ headers: new Headers({ cookie }) }));
  const session = await f.auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(direct) }) });
  assert.equal(session.session.ipAddress, '198.51.100.33');
  assert.match((await direct.json()).token, /^cookie\./);
});

test('three code issuances share a normalized account budget across IPs; another NAT account is independent', async (t) => {
  const f = await harness(t);
  for (let i = 0; i < 4; i++) {
    const response = await f.send('/api/login-code', { email: i % 2 ? ` ${f.user.email.toUpperCase()} ` : f.user.email }, `198.51.100.${40 + i}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: 'Если такой адрес есть, код отправлен.' });
  }
  assert.equal(f.mails.length, 3);
  const user = await f.ctx.internalAdapter.createUser({ name: 'Other', email: 'other-code@example.test', emailVerified: true, role: 'user' });
  current.user = { ...user, _id: user.id, isEndUser: true };
  assert.equal((await f.send('/api/login-code', { email: user.email }, '198.51.100.40')).status, 200);
  assert.equal(f.mails.length, 4);
});

test('ten password/code failures per pair survive changing forwarding prefixes, code/password share code budget', async (t) => {
  const f = await harness(t);
  for (let i = 0; i < 10; i++) {
    const response = await f.send('/api/login', { email: 'pair-controller@example.test', password: 'wrong' }, '198.51.100.51', { 'x-forwarded-for': `${i}.2.2.2, 198.51.100.51, 10.0.0.2` });
    assert.ok([401, 429].includes(response.status));
  }
  const blocked = await f.send('/api/login', { email: 'pair-controller@example.test', password: 'wrong' }, '198.51.100.51');
  assert.equal(blocked.status, 429); assert.equal((await blocked.json()).locked, true);
  for (let i = 0; i < 10; i++) assert.equal((await f.send(i % 2 ? '/api/login-code/password' : '/api/login-code/verify', { email: f.user.email, otp: '000000', password: PASSWORD }, '198.51.100.52')).status, 401);
  assert.equal((await f.send('/api/login-code/verify', { email: f.user.email, otp: '000000' }, '198.51.100.52')).status, 429);
  assert.equal((await f.send('/api/login-code/verify', { email: 'other-pair@example.test', otp: '000000' }, '198.51.100.52')).status, 401);
  assert.equal((await f.send('/api/login-code/verify', {}, '198.51.100.53')).status, 401);
});

test('successful password logins do not consume failure budget or share a library bucket', async (t) => {
  const f = await harness(t);
  for (let i = 0; i < 12; i++) {
    assert.equal((await f.send('/api/login', { email: f.user.email, password: PASSWORD }, '198.51.100.61')).status, 200);
  }
});

test('broad IP budget remains 50/hour even when an attacker varies accounts', async (t) => {
  const f = await harness(t);
  for (let i = 0; i < 50; i++) assert.equal((await f.send('/api/login-code', { email: `rotating${i}@example.test` }, '198.51.100.62')).status, 200);
  const blocked = await f.send('/api/login-code', { email: 'fresh-broad@example.test' }, '198.51.100.62');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('real password cannot issue sessions to banned/service/inactive-company accounts', async (t) => {
  const f = await harness(t);
  for (const flags of [{ banned: true }, { isServiceAccount: true }, { company: { isActive: false } }]) {
    current.user = { ...f.user, ...flags };
    const response = await f.send('/password-direct', { email: f.user.email, password: PASSWORD });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(f.data.authSessions.length, 0);
  }
});

test('same-/64 password rotation stops verifier at ten failures while another subnet/account stays available with exact audit IP', async (t) => {
  const f = await harness(t);
  let verifies = 0;
  const verify = f.ctx.password.verify;
  t.mock.method(f.ctx.password, 'verify', async (args) => { verifies++; return verify(args); });
  for (let i = 1; i <= 60; i++) {
    await f.send('/api/login', { email: f.user.email, password: 'wrong-password' }, `2001:db8:abcd:1234::${i.toString(16)}`);
  }
  assert.equal(verifies, 10);
  assert.equal((await f.send('/api/login', { email: f.user.email, password: PASSWORD }, '2001:db8:abcd:1235::beef')).status, 200);
  const rows = f.data.authSessions;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ipAddress, '2001:db8:abcd:1235::beef');
});

test('application broad IP budget groups /64 rotation even when accounts vary', async (t) => {
  const f = await harness(t);
  for (let i = 1; i <= 50; i++) {
    assert.equal((await f.send('/api/login-code', { email: `ipv6-broad-${i}@example.test` }, `2001:db8:56:1::${i.toString(16)}`)).status, 200);
  }
  assert.equal((await f.send('/api/login-code', { email: 'fresh-ipv6-broad@example.test' }, '2001:db8:56:1::ff')).status, 429);
});
