require('module-alias/register');
const test = require('node:test');
const assert = require('node:assert/strict');
const Company = require('../../models/company');
const { hydrate } = require('./company-events');
const id = '222222222222222222222222';
test('legacy company events resolve names including empty schema snapshots; deleted IDs never reach prose', async (t) => {
  t.mock.method(Company, 'find', () => ({ select: () => ({ lean: async () => [{ _id: id, alias: 'Заказчик' }] }) }));
  const results = await hydrate([
    { kind: 'companyChanged', companyChange: { from: {}, to: {} }, message: `Привязка компании изменена (не назначена → ${id})` },
    { kind: 'companyChanged', message: 'Привязка компании изменена (333333333333333333333333 → не назначена)' },
  ]);
  assert.equal(results[0].message, 'Привязка компании изменена (не назначена → Заказчик)');
  assert.equal(results[1].message, 'Привязка компании изменена (неизвестная компания → не назначена)');
  assert.equal(results[0].companyChange, undefined);
});
test('new events retain historical names when companies were renamed or deleted', async (t) => {
  t.mock.method(Company, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  const [result] = await hydrate([{ kind: 'companyChanged', companyChange: { from: { id, name: 'Прежнее имя' }, to: { id: null, name: 'не назначена' } } }]);
  assert.equal(result.message, 'Привязка компании изменена (Прежнее имя → не назначена)');
});
