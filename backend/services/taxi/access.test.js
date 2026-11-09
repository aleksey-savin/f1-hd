const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canViewTrip, canOpenReport, requireStaff } = require('./access');
const actor = (userId, permissions = [], isEndUser = false) => ({ userId, isEndUser, can: ({ taxi }) => permissions.includes(taxi[0]) });
test('staff can read their own ride but cannot access another without read', () => {
  assert.equal(canViewTrip(actor('a'), { userId: 'a' }), true);
  assert.equal(canViewTrip(actor('a'), { userId: 'b' }), false);
  assert.equal(canViewTrip(actor('a', ['read']), { userId: 'b' }), true);
  assert.throws(() => requireStaff(actor('a', ['read'], true)));
  assert.equal(canViewTrip(actor('a', ['read'], true), { userId: 'a' }), false);
});
test('only retained taxi rights open the report and historical booking rights grant no access', () => {
  for (const permission of ['read', 'allocate', 'configure']) assert.equal(canOpenReport(actor('a', [permission])), true);
  for (const permission of ['order', 'dispatch']) {
    assert.equal(canOpenReport(actor('a', [permission])), false);
    assert.equal(canViewTrip(actor('a', [permission]), { userId: 'b' }), false);
  }
  assert.equal(canViewTrip(actor('a', ['allocate']), { userId: 'b' }), true);
});
