const { test } = require('node:test');
const assert = require('node:assert/strict');
const policyModule = require('./authRatePolicy');

test('proxy configuration rejects permissive/coerced hop counts', () => {
  for (const value of ['-1', '1.5', 'Infinity', 'NaN', 'true', '', ' 2', '0x2', '2e0']) {
    assert.throws(() => policyModule.parseTrustProxyHops(value), /TRUST_PROXY_HOPS/);
  }
  assert.equal(policyModule.parseTrustProxyHops(undefined), 0);
  for (const value of ['0', '1', '2']) assert.equal(policyModule.parseTrustProxyHops(value), Number(value));
});

test('account/IP keys normalize missing email, IPv6 and mapped IPv4 without collisions', () => {
  const { pairKey } = policyModule;
  assert.equal(pairKey('password', '2001:DB8::1', ' A@EXAMPLE.TEST '), pairKey('password', '2001:0db8:0:0:0:0:0:1', 'a@example.test'));
  assert.equal(pairKey('password', '::ffff:192.0.2.1'), pairKey('password', '192.0.2.1', undefined));
  assert.notEqual(pairKey('password', '192.0.2.1', 'a'), pairKey('password', '192.0.2.1', 'b'));
  assert.notEqual(pairKey('password', '192.0.2.1', 'a'), pairKey('code', '192.0.2.1', 'a'));
  assert.doesNotThrow(() => pairKey('code', '192.0.2.1', {}));
});

test('fixed pair window allows ten failures; blocked retries do not move expiry', () => {
  let time = 0;
  const policy = policyModule.createAuthRatePolicy({ now: () => time });
  for (let i = 0; i < 10; i++) assert.equal(policy.consume('pair', 10, 900000).allowed, true);
  time = 899999;
  assert.deepEqual(policy.consume('pair', 10, 900000), { allowed: false, resetAt: 900000 });
  time = 900000;
  assert.equal(policy.consume('pair', 10, 900000).allowed, true);
});

test('account cooldown doubles to 30s, expires, resets on success and retries cannot extend it', () => {
  let time = 0;
  const policy = policyModule.createAuthRatePolicy({ now: () => time });
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const deadline = time + delay;
    assert.equal(policy.credentialFailure(' A@EXAMPLE.TEST ').resetAt, deadline);
    time += delay - 1;
    assert.equal(policy.credentialFailure('a@example.test').resetAt, deadline);
    assert.equal(policy.cooldown('a@example.test').resetAt, deadline);
    time++;
    assert.equal(policy.cooldown('a@example.test').allowed, true);
  }
  policy.credentialSuccess('a@example.test');
  assert.equal(policy.credentialFailure('a@example.test').resetAt, time + 1000);
  time += 900001;
  assert.equal(policy.credentialFailure('a@example.test').resetAt, time + 1000);
});

test('state has a hard bound and expires without incoming writes', () => {
  let time = 0;
  const policy = policyModule.createAuthRatePolicy({ now: () => time, maxEntries: 8 });
  for (let i = 0; i < 100; i++) {
    policy.consume(`ip${i}`, 50, 3600000);
    policy.credentialFailure(`user${i}`);
    assert.ok(policy.size <= 8);
  }
  time = 3600001;
  assert.equal(policy.size, 0);
});

test('pure counter step never mutates a snapshot and resets exactly at the window boundary', () => {
  const old = { count: 10, expiresAt: 900000 };
  assert.deepEqual(policyModule.counterStep(old, 899999, 10, 900000), { allowed: false, next: old, resetAt: 900000 });
  assert.deepEqual(policyModule.counterStep(old, 900000, 10, 900000), { allowed: true, next: { count: 1, expiresAt: 1800000 }, resetAt: 1800000 });
  assert.deepEqual(old, { count: 10, expiresAt: 900000 });
});

test('factor keys require resolved identity; raw cookie values cannot select independent buckets', () => {
  const { challengeKey } = policyModule;
  assert.equal(challengeKey('192.0.2.1', 'hd.two_factor=first'), challengeKey('192.0.2.1', 'hd.two_factor=second'));
  assert.notEqual(challengeKey('192.0.2.1', { kind: 'session', id: 'one' }), challengeKey('192.0.2.1', { kind: 'session', id: 'two' }));
  assert.equal(challengeKey('192.0.2.1', { kind: 'challenge', id: 'one' }), challengeKey('192.0.2.2', { kind: 'challenge', id: 'one' }));
});

test('IPv6 abuse keys aggregate /64 host rotation without masking canonical audit identity or mapped IPv4', () => {
  const { pairKey, normalizeIp } = policyModule;
  assert.equal(pairKey('password', '2001:db8:abcd:1234::1', 'a'), pairKey('password', '2001:db8:abcd:1234:ffff:ffff:ffff:ffff', 'a'));
  assert.notEqual(pairKey('password', '2001:db8:abcd:1234::1', 'a'), pairKey('password', '2001:db8:abcd:1235::1', 'a'));
  assert.equal(normalizeIp('2001:db8:abcd:1234::beef'), '2001:db8:abcd:1234::beef');
  assert.equal(pairKey('password', '::ffff:c000:201', 'a'), pairKey('password', '192.0.2.1', 'a'));
});
