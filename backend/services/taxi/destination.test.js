const { test } = require('node:test');
const assert = require('node:assert/strict');
const { destinationIndex, matchDestination } = require('./destination');
const company = { _id: 'company', address: 'Владивосток, ул. Шилкинская, д. 32а', location: { lat: 43.12, lon: 131.92 } };
const index = (companies = [company], subdivisions = []) => destinationIndex(companies, subdivisions);
test('destination matches a company address despite prefixes, punctuation and case', () => {
  assert.equal(matchDestination({ address: 'Россия, Приморский край, Владивосток, Шилкинская улица, 32А' }, index())?.companyId, 'company');
  assert.equal(matchDestination({ address: 'Шилкинская, 32а' }, index())?.companyId, 'company');
});
test('nearby approximate coordinates work for subdivisions and coordinate-only points', () => {
  const offices = index([company], [{ company: 'company', address: 'Офис на Океанском', location: { lat: 43.15, lon: 131.89 } }]);
  assert.equal(matchDestination({ address: 'Точка назначения', lat: 43.151, lon: 131.89 }, offices)?.companyId, 'company');
  assert.equal(matchDestination({ lat: 43.151, lon: 131.89 }, offices)?.companyId, 'company');
  assert.equal(matchDestination({ lat: 43.153, lon: 131.89 }, offices), null);
});
test('an explicit different building is not a nearby-client match for a home or shop trip', () => {
  for (const address of ['Шилкинская, 32', 'Шилкинская, 132а', 'Шилкинская, 32/1', 'Другая улица, 32а']) {
    assert.equal(matchDestination({ address, lat: 43.1201, lon: 131.92 }, index()), null, address);
  }
});
test('several companies at the same destination stay unassigned; branches of one company do not create ambiguity', () => {
  const other = { ...company, _id: 'other' };
  assert.equal(matchDestination({ address: 'Шилкинская, 32а', ...company.location }, index([company, other])), null);
  assert.equal(matchDestination({ ...company.location }, index([company, other])), null);
  const offices = index([company], [{ ...company, company: 'company' }]);
  assert.equal(matchDestination({ address: 'Шилкинская, 32а' }, offices)?.companyId, 'company');
});
test('inactive companies, absent or invalid coordinates, and another city are not guessed', () => {
  assert.equal(matchDestination({ ...company.location }, index([{ ...company, isActive: false }])), null);
  assert.equal(matchDestination({ lat: null, lon: null }, index([{ _id: 'empty', location: { lat: null, lon: null } }])), null);
  assert.equal(matchDestination({ lat: 43.12, lon: 131.92 }, index([{ ...company, location: { lat: 91, lon: 131.92 } }])), null);
  assert.equal(matchDestination({ address: 'Шилкинская, 32а', lat: 55, lon: 37 }, index()), null);
});
test('an abbreviated city prefix is allowed, but a different street name or street type is not', () => {
  assert.equal(matchDestination({ address: 'Большая Садовая, 32' }, index([{ _id: 'garden', address: 'Садовая, 32' }])), null);
  assert.equal(matchDestination({ address: 'улица Ленина, 5', lat: 43.1201, lon: 131.92 }, index([{ ...company, address: 'проспект Ленина, 5' }])), null);
  assert.equal(matchDestination({ address: 'Москва, улица Шилкинская, 32а' }, index()), null);
  assert.equal(matchDestination({ address: 'Владивосток, Океанский проспект, 5' }, index([{ _id: 'ocean', address: 'г. Владивосток, Океанский пр-т, 5' }]))?.companyId, 'ocean');
});
