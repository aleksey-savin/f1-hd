require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { syncOnce } = require('./sync');
const settings = { clientId: 'corp', historyDays: 14 };
const make = (trip, failReport = false, purpose = 'business') => {
  const state = { events: [], complete: false };
  const store = {
    heartbeat: async () => {}, existingActive: async () => [],
    saveEmployees: async () => {}, saveTrip: async (row) => { state.events.push(['saved', row.purpose]); return { ...row, purpose, _id: 'trip', userId: 'user' }; },
    live: async (row) => state.events.push(['live', row.purpose]), saveFinance: async () => {},
    complete: async () => { state.complete = true; },
  };
  const provider = async (path) => {
    if (path === '/users') return { items: [] };
    if (path === '/orders/list') return { items: [trip], total_amount: 1 };
    if (path === '/orders/info') return trip;
    if (path === '/orders/taxi/report') { if (failReport) throw new Error('failed'); return { orders: [{ id: trip.id }] }; }
    throw new Error(path);
  };
  return { state, store, provider };
};
const order = (status = 'transporting') => ({ id: 'id', user_id: 'external', status });
test('live presence is only applied to business transporting orders', async () => {
  for (const purpose of ['home', 'unknown', 'business']) {
    const fixture = make(order(), false, purpose);
    await syncOnce({ settings, ...fixture, now: new Date('2026-11-09T00:00:00Z') });
    assert.equal(fixture.state.events.some(([name]) => name === 'live'), purpose === 'business');
  }
  const historical = make(order('complete'));
  await syncOnce({ settings, ...historical, now: new Date('2026-11-09T00:00:00Z') });
  assert.equal(historical.state.events.some(([name]) => name === 'live'), false);
});
test('a partial provider failure never advances the watermark', async () => {
  const fixture = make(order(), true);
  fixture.provider = async (path) => { if (path === '/users') return { items: [] }; throw new Error('partial list failure'); };
  await assert.rejects(syncOnce({ settings, ...fixture, now: new Date() }));
  assert.equal(fixture.state.complete, false);
});

test('report requests contain at most 100 distinct trips', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ id: String(index), user_id: 'u', status: 'complete' }));
  const batches = [];
  const store = { heartbeat: async () => {}, existingActive: async () => [], saveEmployees: async () => {}, saveTrip: async (row) => row, saveFinance: async () => {}, live: async () => { throw new Error('unexpected'); }, complete: async () => {} };
  const provider = async (path, options) => {
    if (path === '/users') return { items: [] };
    if (path === '/orders/list') return { items: rows.slice(options.query.offset, options.query.offset + options.query.limit), total_amount: rows.length };
    if (path === '/orders/taxi/report') { batches.push(options.body.ids); return { orders: options.body.ids.map((id) => ({ id })) }; }
    throw new Error(path);
  };
  await syncOnce({ settings, provider, store });
  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 5]);
});

test('a stale transporting list entry cannot trigger a live announcement', async () => {
  const fixture = make(order());
  const baseProvider = fixture.provider;
  fixture.provider = (path, options) => path === '/orders/info' ? Promise.resolve(order('complete')) : baseProvider(path, options);
  await syncOnce({ settings, ...fixture });
  assert.equal(fixture.state.events.some(([name]) => name === 'live'), false);
});

test('a claimed start is recovered after the trip has already finished', async () => {
  const fixture = make(order('complete'));
  fixture.store.pending = async () => [{ _id: 'claimed', purpose: 'business', status: 'complete', presenceAppliedAt: new Date(), userId: 'user' }];
  await syncOnce({ settings, ...fixture });
  assert.equal(fixture.state.events.filter(([name]) => name === 'live').length, 1);
});

test('history starts at the organization calendar boundary', () => {
  const { historyStart } = require('./sync');
  assert.equal(historyStart(new Date('2026-11-09T02:00:00Z'), 1, 'Asia/Vladivostok'), '2026-11-07T14:00:00.000Z');
});

test('financial report enriches completed trips with actual times and exact cost', async () => {
  const fixture = make(order('complete'));
  let saved;
  fixture.store.saveTrip = async (row) => row;
  fixture.store.saveFinance = async (_id, row) => { saved = row; };
  const baseProvider = fixture.provider;
  fixture.provider = (path, options) => path === '/orders/taxi/report' ? Promise.resolve({ orders: [{ id: 'id', total_cost: '123.45', start_datetime: '2026-11-08T00:00:00Z', finish_datetime: '2026-11-08T00:30:00Z' }] }) : baseProvider(path, options);
  await syncOnce({ settings, ...fixture });
  assert.equal(saved.totalMinor, 12345);
  assert.equal(saved.startedAt.toISOString(), '2026-11-08T00:00:00.000Z');
  assert.equal(saved.finishedAt.toISOString(), '2026-11-08T00:30:00.000Z');
});

test('active trips are saved and announced even when their financial report is unavailable', async () => {
  const fixture = make(order(), true);
  const summary = await syncOnce({ settings, ...fixture });
  assert.deepEqual(fixture.state.events, [['saved', 'unknown'], ['live', 'business']]);
  assert.equal(fixture.state.complete, true);
  assert.equal(summary.imported, 1);
});

test('financial delay does not suppress completed operational imports', async () => {
  const fixture = make(order('complete'), true);
  fixture.store.saveFinance = async () => { throw new Error('unexpected'); };
  const summary = await syncOnce({ settings, ...fixture });
  assert.equal(fixture.state.complete, true);
  assert.equal(fixture.state.events[0][0], 'saved');
  assert.equal(summary.financialPending, true);
});

test('a later financial retry enriches the same stored trip', async () => {
  const fixture = make(order('complete'), true);
  const records = new Map();
  fixture.store.saveTrip = async (row) => { records.set(row.externalId, { ...records.get(row.externalId), ...row }); return records.get(row.externalId); };
  fixture.store.saveFinance = async (id, finance) => { Object.assign(records.get(id), finance); };
  assert.equal((await syncOnce({ settings, ...fixture })).financialPending, true);
  const provider = fixture.provider;
  fixture.provider = (path, options) => path === '/orders/taxi/report' ? Promise.resolve({ orders: [{ id: 'id', total_cost: 123.45 }] }) : provider(path, options);
  assert.equal((await syncOnce({ settings, ...fixture })).financialPending, false);
  assert.equal(records.size, 1);
  assert.equal(records.get('id').totalMinor, 12345);
});

test('overdue financial reconciliation is retried outside the history window', async () => {
  const fixture = make(order('transporting'));
  fixture.store.pendingFinance = async () => [{ externalId: 'older' }];
  const ids = [];
  fixture.store.markFinancePending = async () => {};
  fixture.store.saveFinance = async (id) => { ids.push(id); };
  const provider = fixture.provider;
  fixture.provider = (path, options) => path === '/orders/taxi/report' ? Promise.resolve({ orders: options.body.ids.map((id) => ({ id, total_cost: 200 })) }) : provider(path, options);
  await syncOnce({ settings, ...fixture });
  assert.deepEqual(ids, ['older']);
});

test('a report row without a final amount remains pending', async () => {
  const fixture = make(order('complete'));
  let applied = false;
  fixture.store.saveFinance = async () => { applied = true; };
  const result = await syncOnce({ settings, ...fixture });
  assert.equal(result.financialPending, true);
  assert.equal(applied, false);
});

test('an empty successful financial report is pending, not a synchronization error', async () => {
  const fixture = make(order('cancelled'));
  const provider = fixture.provider;
  fixture.provider = (path, options) => path === '/orders/taxi/report' ? Promise.resolve({ orders: [] }) : provider(path, options);
  let health;
  fixture.store.complete = async (_now, summary) => { health = summary; };
  const result = await syncOnce({ settings, ...fixture });
  assert.equal(result.imported, 1);
  assert.equal(result.financialPending, true);
  assert.equal(result.financialError, '');
  assert.deepEqual(health, { financialPending: true, financialError: '' });
});

test('financial request failures and invalid responses remain errors while operational imports finish', async () => {
  for (const report of [async () => { throw new Error('secret provider details'); }, async () => ({}), async () => ({ orders: [{ id: 'id', total_cost: 'invalid' }] })]) {
    const fixture = make(order('complete'));
    const provider = fixture.provider;
    fixture.provider = (path, options) => path === '/orders/taxi/report' ? report() : provider(path, options);
    const result = await syncOnce({ settings, ...fixture });
    assert.equal(result.financialPending, true);
    assert.match(result.financialError, /финансов/i);
    assert.equal(result.financialError.includes('secret'), false);
    assert.equal(fixture.state.complete, true);
  }
});

test('a pending financial report does not record a connection failure', async (t) => {
  const { TaxiSettings } = require('../../models/taxi');
  const { createStore } = require('./sync');
  const updates = [];
  t.mock.method(TaxiSettings, 'updateOne', async (_filter, update) => { updates.push(update.$set); return { matchedCount: 1 }; });
  await createStore({ clientId: 'corp', token: 'cipher' }, 'lease').complete(new Date(), { financialPending: true, financialError: '' });
  const update = updates.at(-1);
  assert.equal(update['health.lastError'], '');
  assert.equal(update['health.financialPending'], true);
  assert.equal(update['health.financialError'], '');
});

test('unmapped employees do not block ride import or financial reconciliation', async () => {
  const fixture = make(order('complete'));
  const provider = fixture.provider;
  let amount;
  fixture.provider = (path, options) => path === '/orders/taxi/report'
    ? Promise.resolve({ orders: [{ id: 'id', total_cost: 123.45 }] })
    : path === '/users' ? Promise.resolve({ items: [{ id: 'external', is_active: false }] }) : provider(path, options);
  fixture.store.saveTrip = async (row) => row;
  fixture.store.live = async () => assert.fail('Unmapped employee must not change a status');
  fixture.store.saveFinance = async (_id, financial) => { amount = financial.totalMinor; };
  const result = await syncOnce({ settings, ...fixture });
  assert.equal(result.imported, 1);
  assert.equal(result.financialPending, false);
  assert.equal(amount, 12345);
});

test('deleted trips cannot reappear, trigger presence or enter financial requests on sync', async () => {
  const fixture = make(order('complete'));
  fixture.store.saveTrip = async (parsed) => ({ ...parsed, deletedAt: new Date(), purpose: 'business', userId: 'user' });
  fixture.store.live = async () => assert.fail('deleted ride cannot announce');
  const provider = fixture.provider;
  fixture.provider = (path, options) => { if (path === '/orders/taxi/report') assert.fail('deleted ride cannot request finance'); return provider(path, options); };
  const result = await syncOnce({ settings, ...fixture });
  assert.equal(result.imported, 0);
});
