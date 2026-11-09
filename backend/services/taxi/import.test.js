const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseOrder, collectPages } = require('./import');
test('the documented finance destination preserves cost and actual timestamps', () => {
  const { parseFinance } = require('./import');
  const result = parseFinance({ id: 'x', total_cost: 290, destination: [131.7,43.1], destination_fullname: 'Шилкинская, 32а', start_datetime: '2026-11-09T00:00:00Z' });
  assert.equal(result.totalMinor, 29000);
  assert.deepEqual(result.destination, { address: 'Шилкинская, 32а', lon: 131.7, lat: 43.1 });
  assert.equal(result.startedAt.toISOString(), '2026-11-09T00:00:00.000Z');
});
test('Go imports leave intent unknown and ignore retired corporate questions', () => {
  const row = { id: 'a', user_id: 'u', status: 'transporting' };
  for (const cost_center_values of [undefined, [{ id: 'purpose', value: 'home' }], { obsolete: true }]) {
    assert.equal(parseOrder({ ...row, cost_center_values }, { purposeCostCenterId: 'purpose' }).purpose, 'unknown');
  }
  assert.throws(() => parseOrder({ ...row, id: null }));
});
test('pagination fails rather than silently accepting a partial page sequence', async () => {
  let requests = 0;
  await assert.rejects(collectPages(async () => {
    requests++;
    if (requests === 1) return { items: [{ id: 'a' }], total_amount: 2 };
    throw new Error('provider failure');
  }, 1));
});

test('employee cursor pagination detects a repeating cursor', async () => {
  const { collectEmployees } = require('./import');
  await assert.rejects(collectEmployees(async () => ({ items: [], next_cursor: 'same' })));
  const result = await collectEmployees(async (cursor) => cursor ? { items: [{ id: 'b' }] } : { items: [{ id: 'a' }], next_cursor: 'next' });
  assert.deepEqual(result.map((row) => row.id), ['a', 'b']);
});

test('provider requested time stays distinct from the actual start', () => {
  const parsed = parseOrder({ id: 'a', user_id: 'u', status: 'complete', due_date: '2026-11-09T00:00:00Z' }, {});
  assert.equal(parsed.requestedAt.toISOString(), '2026-11-09T00:00:00.000Z');
  assert.equal(parsed.startedAt, undefined);
});
