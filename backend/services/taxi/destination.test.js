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

test('office floors and a provider POI suffix do not replace the actual street and building', () => {
 const office={_id:'office',address:'ул. Пограничная, 15в, 6 этаж, оф. 607',location:{lat:43.123143,lon:131.881335}};
 const destination={address:'Россия, Приморский край, Владивосток, Пограничная улица, 15В, Чайхана № 1',lat:43.12329518,lon:131.8817186};
 assert.deepEqual(matchDestination(destination,index([office])),{companyId:'office',method:'address'});
 assert.equal(matchDestination({...destination,address:'Владивосток, Пограничная улица, 15Б, Чайхана № 1'},index([office])),null);
 assert.equal(matchDestination({...destination,address:'Москва, Пограничная улица, 15В, Чайхана № 1'},index([{...office,address:`Владивосток, ${office.address}`}])),null);
 const other={...office,_id:'client',address:'Владивосток, Пограничная улица, 15в, каб. 508, офис, 5 этаж'};
 assert.equal(matchDestination(destination,index([office,other])),null);
});

test('inline office and room suffixes retain the house for matching and nearby-building rejection', () => {
 for(const address of ['Владивосток, Шилкинская, 32а офис 1','Владивосток, Шилкинская 32а офис 1','Владивосток, Шилкинская, 32а помещение 7','Владивосток, Шилкинская, 32а, 6 этаж, каб. 607']) {
  const offices=index([{...company,address}]);
  assert.equal(matchDestination({address:'Владивосток, Шилкинская улица, 32А'},offices)?.companyId,'company',address);
  assert.equal(matchDestination({address:'Владивосток, Шилкинская улица, 34',lat:43.1201,lon:131.92},offices),null,address);
 }
});
