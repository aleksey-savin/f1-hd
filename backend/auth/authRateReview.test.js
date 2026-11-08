const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, PASSWORD, ORIGIN, cookieFrom, secretFromURI } = require('./__tests__/browserSession.fixture.cjs');
const { createAuthRatePolicy, AUTH_IP_HEADER } = require('../services/authRatePolicy');

const headers = (ip, cookie) => new Headers({ [AUTH_IP_HEADER]: ip, origin: ORIGIN, ...(cookie ? { cookie } : {}) });
const request = (path, ip, cookie, body) => new Request(`${ORIGIN}/api/auth${path}`, {
  method: body ? 'POST' : 'GET', headers: { ...Object.fromEntries(headers(ip, cookie)), ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

async function configured(f, options = {}) {
  const { createAuth } = await import('./instance.mjs');
  const { memoryAdapter } = await import('better-auth/adapters/memory');
  f.auth = createAuth({ database: memoryAdapter(f.data), ratePolicy: options.policy,
    config: { ...require('./config'), secret: f.ctx.options.secret, baseURL: ORIGIN, useSecureCookies: !!options.secure, trustedOrigins: [ORIGIN] },
    statement: require('./access').STATEMENT,
    hooks: { sessionRefusal: async () => null, checkPasswordBreach: async () => ({ breached: false }),
      sendEmailCode: async (mail) => f.mails.push(mail), sendMagicLink: async (mail) => f.mails.push(mail), sendResetPassword: async () => {} },
  });
  f.ctx = await f.auth.$context;
  f.login = () => f.auth.api.signInEmail({ body: { email: f.user.email, password: PASSWORD }, asResponse: true });
  return f;
}

async function factorReady(f) {
  const cookie = cookieFrom(await f.login());
  const setup = await f.auth.api.enableTwoFactor({ headers: headers('192.0.2.1', cookie), body: { password: PASSWORD } });
  const code = (await f.auth.api.generateTOTP({ body: { secret: secretFromURI(setup.totpURI) } })).code;
  const verified = await f.auth.api.verifyTOTP({ headers: headers('192.0.2.1', cookie), body: { code }, asResponse: true });
  const sessionCookie = cookieFrom(verified) || cookie;
  const challenge = await f.login();
  assert.equal((await challenge.clone().json()).twoFactorRedirect, true);
  return { sessionCookie, challengeCookie: cookieFrom(challenge) };
}

test('session-first raw setup budget survives rotating forged challenges and ignored secure cookie variants', async (t) => {
  const f = await fixture();
  const cookie = cookieFrom(await f.login());
  let verifies = 0;
  const actual = f.ctx.password.verify;
  t.mock.method(f.ctx.password, 'verify', async (args) => { verifies++; return actual(args); });
  for (let i = 0; i < 30; i++) {
    const extra = i % 2 ? `hd.two_factor=forged-${i}` : `__Secure-hd.session_token=forged-${i}; __Secure-hd.two_factor=forged-${i}`;
    const response = await f.auth.handler(request('/two-factor/enable', '198.51.100.101', `${extra}; ${cookie}`, { password: 'wrong-password' }));
    assert.equal(response.status, 400);
  }
  const blocked = await f.auth.handler(request('/two-factor/disable', '198.51.100.102', `hd.two_factor=last-forgery; ${cookie}`, { password: 'wrong-password' }));
  assert.equal(blocked.status, 429);
  assert.equal(verifies, 30);
  assert.equal(f.data.authSessions.length, 1);
  const independent = cookieFrom(await f.login());
  assert.equal((await f.auth.handler(request('/two-factor/enable', '198.51.100.101', independent, { password: 'wrong-password' }))).status, 400);
});

test('invalid/expired/signed-but-unbacked cookies cannot mint new factor buckets', async () => {
  const f = await fixture();
  for (let i = 0; i < 30; i++) {
    const response = await f.auth.handler(request('/two-factor/verify-totp', '198.51.100.103', `hd.session_token=bad-${i}; hd.two_factor=bad-${i}`, { code: '000000' }));
    assert.equal(response.status, 401);
  }
  assert.equal((await f.auth.handler(request('/two-factor/verify-totp', '198.51.100.103', 'hd.two_factor=new-forgery', { code: '000000' }))).status, 429);
  assert.equal((await f.auth.handler(request('/two-factor/verify-totp', '198.51.100.104', 'hd.two_factor=new-forgery', { code: '000000' }))).status, 401);
});

test('configured signed challenge matches plugin identity despite forged session and unrelated cookies', async () => {
  const f = await fixture();
  const { sessionCookie, challengeCookie } = await factorReady(f);
  assert.equal(typeof f.auth.api.resolveFactorRateIdentity, 'function');
  const resolve = (cookie, path = '/two-factor/verify-totp') => f.auth.api.resolveFactorRateIdentity({ headers: headers('198.51.100.105', cookie), body: { path } });
  const sessionIdentity = await resolve(sessionCookie);
  assert.equal(sessionIdentity.kind, 'session');
  assert.deepEqual(await resolve(`${sessionCookie}; ${challengeCookie}`), sessionIdentity);
  const identity = await resolve(challengeCookie);
  assert.equal(identity.kind, 'challenge');
  assert.deepEqual(await resolve(`hd.session_token=forged; __Secure-hd.two_factor=ignored; ${challengeCookie}`), identity);
  assert.equal(await resolve(challengeCookie, '/two-factor/enable'), null);
  const encoded = challengeCookie.replace(/hd.two_factor=/, '__Secure-hd.two_factor=');
  assert.equal(await resolve(encoded), null);
  assert.deepEqual(await resolve(`${challengeCookie}; hd.session_token=invalid`), identity);
  assert.deepEqual(await resolve(`${sessionCookie}; ${sessionCookie.split('=')[0]}=invalid`), sessionIdentity);
  const sessionId = sessionIdentity.id.split('!').at(-1);
  f.data.authSessions.find((row) => row.id === sessionId).expiresAt = new Date(Date.now() - 1000);
  assert.deepEqual(await resolve(`${sessionCookie}; ${challengeCookie}`), identity);

  const verifier = f.data.authVerifications.find((row) => row.identifier === identity.id);
  verifier.expiresAt = new Date(Date.now() - 1000);
  assert.equal(await resolve(challengeCookie), null);
  const orphan = cookieFrom(await f.login());
  const orphanId = await resolve(orphan);
  assert.equal(orphanId.kind, 'challenge');
  await f.ctx.internalAdapter.deleteVerificationByIdentifier(orphanId.id);
  assert.equal(await resolve(orphan), null);

});

test('magic invalid and consumed-token redirects consume five-request window and expire without altering redirect contracts', async () => {
  let time = 0;
  const policy = createAuthRatePolicy({ now: () => time });
  const f = await configured(await fixture(), { policy });
  const raw = (req) => f.auth.handler(req);
  for (let i = 0; i < 5; i++) {
    const response = await raw(request('/magic-link/verify?token=review-invalid&callbackURL=%2F', '198.51.100.106'));
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get('location')).searchParams.get('error'), 'INVALID_TOKEN');
  }
  assert.equal((await raw(request('/magic-link/verify?token=review-invalid&callbackURL=%2F', '198.51.100.106'))).status, 429);
  time = 60000;
  assert.equal((await raw(request('/magic-link/verify?token=review-invalid&callbackURL=%2F', '198.51.100.106'))).status, 302);
  await f.auth.api.signInMagicLink({ headers: headers('198.51.100.107'), body: { email: f.user.email, callbackURL: '/kept' } });
  const link = new URL(f.mails.at(-1).url);
  const make = () => request(link.pathname.replace('/api/auth', '') + link.search, '198.51.100.107');
  const success = await raw(make());
  assert.equal(success.status, 302);
  assert.equal(new URL(success.headers.get('location')).pathname, '/kept');
  assert.ok(cookieFrom(success).includes('hd.session_token='));
  for (let i = 0; i < 4; i++) {
    const consumed = await raw(make());
    assert.equal(consumed.status, 302);
    assert.equal(new URL(consumed.headers.get('location')).searchParams.get('error'), 'INVALID_TOKEN');
  }
  assert.equal((await raw(make())).status, 429);
  await f.auth.api.signInMagicLink({ headers: headers('198.51.100.111'), body: { email: f.user.email, callbackURL: '/kept' } });
  f.data.authVerifications.at(-1).expiresAt = new Date(Date.now() - 1000);
  const expiredLink = new URL(f.mails.at(-1).url);
  const expired = await raw(request(expiredLink.pathname.replace('/api/auth', '') + expiredLink.search, '198.51.100.111'));
  assert.equal(expired.status, 302);
  assert.equal(new URL(expired.headers.get('location')).searchParams.get('error'), 'INVALID_TOKEN');
  assert.equal(f.data.authSessions.length, 1);

});



test('library abuse resolver masks IPv6 /64 while session audit retains exact trusted header', async () => {
  const f = await fixture();
  const { getIp } = await import('better-auth/api');
  for (const ip of ['2001:db8:abcd:1234::1', '2001:db8:abcd:1234::ffff']) {
    assert.equal(getIp(headers(ip), f.ctx.options), '2001:0db8:abcd:1234:0000:0000:0000:0000');
    await f.auth.api.signInEmail({ headers: headers(ip), body: { email: f.user.email, password: PASSWORD } });
    assert.equal(f.data.authSessions.at(-1).ipAddress, ip);
  }
});

test('secure deployment ignores even valid unconfigured unprefixed challenge/session cookie names', async () => {
  const f = await configured(await fixture(), { secure: true });
  const { sessionCookie, challengeCookie } = await factorReady(f);
  const resolve = (cookie) => f.auth.api.resolveFactorRateIdentity({ headers: headers('198.51.100.108', cookie), body: { path: '/two-factor/verify-totp' } });
  assert.equal((await resolve(sessionCookie)).kind, 'session');
  assert.equal(await resolve(sessionCookie.replaceAll('__Secure-hd.', 'hd.')), null);
  assert.equal((await resolve(challengeCookie)).kind, 'challenge');
  assert.equal(await resolve(challengeCookie.replaceAll('__Secure-hd.', 'hd.')), null);
});

test('real signed login challenges behind one NAT keep separate bounded budgets across IP changes', async () => {
  const f = await fixture();
  const { challengeCookie } = await factorReady(f);
  const otherChallenge = cookieFrom(await f.login());
  for (let i = 0; i < 30; i++) {
    const response = await f.auth.handler(request('/two-factor/verify-totp', '198.51.100.109', challengeCookie, {}));
    assert.equal(response.status, 400);
  }
  assert.equal((await f.auth.handler(request('/two-factor/verify-totp', '198.51.100.110', challengeCookie, {}))).status, 429);
  assert.equal((await f.auth.handler(request('/two-factor/verify-totp', '198.51.100.109', otherChallenge, {}))).status, 400);
});

test('raw reset pair/broad and invalid-factor fallback budgets aggregate native IPv6 /64 rotations', async () => {
  const f = await fixture();
  for (let i = 1; i <= 10; i++) {
    assert.equal((await f.auth.handler(request('/reset-password', `2001:db8:55:1::${i}`, null, { token: 'review-ipv6-reset', newPassword: PASSWORD }))).status, 400);
  }
  assert.equal((await f.auth.handler(request('/reset-password', '2001:db8:55:1::b', null, { token: 'review-ipv6-reset', newPassword: PASSWORD }))).status, 429);
  for (let i = 1; i <= 50; i++) {
    assert.equal((await f.auth.handler(request('/reset-password', `2001:db8:55:2::${i.toString(16)}`, null, { token: `rotating-${i}`, newPassword: PASSWORD }))).status, 400);
  }
  assert.equal((await f.auth.handler(request('/reset-password', '2001:db8:55:2::ff', null, { token: 'fresh', newPassword: PASSWORD }))).status, 429);
  for (let i = 1; i <= 30; i++) {
    assert.equal((await f.auth.handler(request('/two-factor/verify-totp', `2001:db8:55:3::${i.toString(16)}`, `hd.two_factor=fake-${i}`, { code: '000000' }))).status, 401);
  }
  assert.equal((await f.auth.handler(request('/two-factor/verify-totp', '2001:db8:55:3::ff', 'hd.two_factor=fresh', { code: '000000' }))).status, 429);
});
