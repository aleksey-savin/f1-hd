require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sift = require('sift').default;
const clone = (value) => value == null ? value : structuredClone(value);
const query = (value) => ({ select() { return this; }, limit() { return this; }, lean: async () => clone(value) });
const stub = (path, exports) => {
  const filename = require.resolve(path);
  const entry = new Module(filename);
  Object.assign(entry, { filename, loaded: true, exports });
  require.cache[filename] = entry;
};
let trips, user, employee, userWrites, failMarker, sharedOffice;
let telegramPreferences, notificationOutbox, notificationWrites, loseOutboxResponse, failOutboxWrite;
const find = (filter) => [...trips.values()].find(sift(filter));
stub('../../models/taxi', { TaxiSettings: {}, TaxiEmployee: { findOne: () => query(employee) }, TaxiTrip: {
  findOne: (filter) => query(find(filter)), findById: (id) => query(trips.get(String(id))),
  exists: async (filter) => Boolean(find(filter)),
  find: (filter) => query([...trips.values()].filter(sift(filter))),
  updateOne: async (filter, change, options) => {
    let trip = find(filter);
    if (!trip && options?.upsert) {
      trip = { _id: filter.externalId, ...change.$setOnInsert };
      trips.set(trip._id, trip);
    }
    if (!trip) return { matchedCount: 0 };
    if (failMarker && change.$set.officeArrivalAppliedAt) throw new Error('interrupted after presence write');
    Object.assign(trip, clone(change.$set));
    return { matchedCount: 1 };
  },
} });
stub('../../models/user', {
  findById: () => query(user),
  updateOne: async (filter, change) => {
    if (!user || !sift(filter)(user)) return { matchedCount: 0 };
    user.workStatus = clone(change.$set.workStatus);
    userWrites++;
    return { matchedCount: 1 };
  },
});
stub('../../models/company', { find: () => query([
  { _id: 'office', address: 'Владивосток, Алеутская, 1', isActive: true },
  { _id: 'client', address: 'Владивосток, Шилкинская, 32а', isActive: true },
  ...(sharedOffice ? [{ _id: 'neighbour', address: 'Владивосток, Алеутская, 1', isActive: true }] : []),
]) });
stub('../../models/subdivision', { find: () => query([]) });
stub('../../models/work', { exists: async () => false });
stub('../../models/preferences', { findOne: () => query(telegramPreferences) });
stub('../../models/notification', { updateOne: async (filter, update) => {
  if (!notificationOutbox) assert.fail('disabled Telegram must not enqueue a notification');
  notificationWrites++;
  if (failOutboxWrite) throw new Error('outbox write unavailable');
  if (!notificationOutbox.has(filter._id)) notificationOutbox.set(filter._id, clone(update.$setOnInsert));
  if (loseOutboxResponse) {
    loseOutboxResponse = false;
    throw new Error('outbox response lost after insert');
  }
} });
const { createStore, syncOnce } = require('./sync');
const at = (time) => new Date(`2026-11-10T${time}:00Z`);
const setup = (changes = {}) => {
  const outbound = { _id: 'outbound', userId: 'user', clientId: 'corp', externalId: 'outbound', purpose: 'business', status: 'complete', requestedAt: at('01:00'), startedAt: at('01:01'), finishedAt: at('01:20'), presenceAppliedAt: at('01:02') };
  const returning = { _id: 'return', userId: 'user', externalUserId: 'external', clientId: 'corp', externalId: 'return', purpose: 'service', status: 'complete', requestedAt: at('02:00'), startedAt: at('02:01'), finishedAt: at('02:20'), destination: { address: 'Владивосток, Алеутская, 1' }, ...changes };
  trips = new Map([[outbound._id, outbound], [returning._id, returning]]);
  user = { _id: 'user', isEndUser: false, workStatus: { code: 'trip', source: 'taxi', taxiTripId: 'outbound', note: 'Клиент · Шилкинская, 32а', auto: false, updatedAt: at('01:02') } };
  employee = { externalId: 'external', userId: 'user', active: true };
  userWrites = 0; failMarker = false; sharedOffice = false;
  telegramPreferences = {}; notificationOutbox = null; notificationWrites = 0; loseOutboxResponse = false;
  failOutboxWrite = false;
  return { store: createStore({ clientId: 'corp', internalCompanyId: 'office' }, 'lease'), returning };
};

test('a completed return to the configured office clears the older client presence even hours later', async () => {
  const { store, returning } = setup();
  await store.arrive?.(returning, at('08:00'));
  assert.equal(user.workStatus.code, 'office');
  assert.equal(user.workStatus.note, '');
  assert.equal(user.workStatus.taxiTripId ?? null, null);
  assert.equal(user.workStatus.updatedAt.toISOString(), at('02:20').toISOString());
  assert.equal(user.workStatus.auto, false);
});

test('sync applies a completed arrival independently of financial report availability', async () => {
  const { store } = setup();
  let arrivals = 0;
  const provider = async (path) => {
    if (path === '/users') return { items: [] };
    if (path === '/orders/list') return { items: [{ id: 'return', user_id: 'external', status: 'complete' }], total_amount: 1 };
    throw new Error('report unavailable');
  };
  await syncOnce({ settings: { clientId: 'corp' }, provider, store: {
    heartbeat: async () => {}, existingActive: async () => [], saveEmployees: async () => {},
    saveTrip: async () => trips.get('return'), arrive: async (...args) => { arrivals++; await store.arrive?.(...args); },
    complete: async () => {},
  }, now: at('02:21') });
  assert.equal(arrivals, 1);
  assert.equal(user.workStatus.code, 'office');
});

test('an office in a shared building restores presence without allocating an ambiguous expense', async () => {
  const { store, returning } = setup({ purpose: 'unknown', companyId: null });
  sharedOffice = true;
  const saved = await store.saveTrip({ ...returning, _id: undefined, purpose: 'unknown' }, {}, at('02:21'));
  assert.equal(saved.purpose, 'unknown');
  assert.equal(saved.companyId, null);
  await store.arrive(saved, at('02:21'));
  assert.equal(user.workStatus.code, 'office');
  assert.equal(trips.get('return').companyId, null);
  assert.equal(trips.get('return').purpose, 'unknown');
});

test('orders, cancellations, personal destinations and deleted trips do not signal office arrival', async () => {
  const cases = [
    ...['new', 'searching', 'driving', 'waiting', 'transporting', 'cancelled', 'canceled', 'failed', 'client_cancelled', 'driver_cancelled'].map((status) => ({ status })),
    { purpose: 'personal' }, { purpose: 'home' }, { deletedAt: at('02:21') }, { historical: true },
    { destination: { address: 'Владивосток, Алеутская, 3' }, companyId: 'office', manuallyAssigned: true },
    { destination: undefined, companyId: 'office', manuallyAssigned: true },
    { finishedAt: undefined }, { finishedAt: at('00:20') },
  ];
  for (const changes of cases) {
    const { store, returning } = setup(changes);
    await store.arrive(returning, at('02:21'));
    assert.equal(user.workStatus.code, 'trip', JSON.stringify(changes));
    assert.equal(userWrites, 0);
  }
});

test('later manual presence, newer client status and newer noncancelled journeys win over history', async () => {
  for (const code of ['trip', 'office', 'offshift', 'lunch', 'remote']) {
    const { store, returning } = setup();
    user.workStatus = { code, source: 'manual', note: 'Ручная заметка', updatedAt: at('02:22') };
    await store.arrive(returning, at('08:00'));
    assert.equal(user.workStatus.source, 'manual');
    assert.equal(userWrites, 0);
  }
  for (const status of ['searching', 'transporting', 'complete']) {
    const { store, returning } = setup();
    trips.set('newer', { _id: 'newer', userId: 'user', requestedAt: at('02:23'), purpose: 'personal', status });
    await store.arrive(returning, at('08:00'));
    assert.equal(user.workStatus.code, 'trip');
    assert.equal(userWrites, 0);
  }
  const { store, returning } = setup();
  trips.set('newer', { _id: 'newer', userId: 'user', requestedAt: at('02:23'), purpose: 'business', status: 'complete' });
  user.workStatus.taxiTripId = 'newer';
  user.workStatus.updatedAt = at('02:24');
  await store.arrive(returning, at('08:00'));
  assert.equal(user.workStatus.taxiTripId, 'newer');
});

test('deleted and cancelled later orders cannot suppress the confirmed return', async () => {
  const { store, returning } = setup();
  trips.set('cancelled', { _id: 'cancelled', userId: 'user', requestedAt: at('02:23'), status: 'cancelled' });
  trips.set('deleted', { _id: 'deleted', userId: 'user', requestedAt: at('02:24'), status: 'transporting', deletedAt: at('02:25') });
  await store.arrive(returning, at('08:00'));
  assert.equal(user.workStatus.code, 'office');
});

test('unmapped, inactive and ineligible staff cannot receive arrival presence', async () => {
  for (const change of [{ isEndUser: true }, { isServiceAccount: true }, { isCloudTelephony: true }, { hideWorkStatus: true }, { banned: true }, { deletedAt: at('01:00') }]) {
    const { store, returning } = setup();
    Object.assign(user, change);
    await store.arrive(returning, at('02:21'));
    assert.equal(userWrites, 0, JSON.stringify(change));
  }
  for (const mapping of [null, { userId: 'other' }, { userId: 'user', active: false }]) {
    const { store, returning } = setup();
    employee = mapping;
    await store.arrive(returning, at('02:21'));
    assert.equal(userWrites, 0);
  }
});

test('observing a live transition to successful completion works without a provider finish timestamp', async () => {
  const { store } = setup({ status: 'transporting', finishedAt: undefined });
  const parsed = { externalId: 'return', externalUserId: 'external', status: 'complete', purpose: 'unknown' };
  const saved = await store.saveTrip(parsed, {}, at('02:20'));
  await store.arrive(saved, at('02:21'));
  assert.equal(user.workStatus.code, 'office');
  assert.equal(user.workStatus.updatedAt.toISOString(), at('02:20').toISOString());
  const replay = await store.saveTrip(parsed, {}, at('08:00'));
  assert.equal(replay.officeArrivalObservedAt.toISOString(), at('02:20').toISOString());
});

test('a first historical completion without arrival evidence does not replace the current visit', async () => {
  const { store } = setup({ status: 'complete', finishedAt: undefined });
  const saved = await store.saveTrip({ externalId: 'return', externalUserId: 'external', status: 'complete', purpose: 'unknown' }, {}, at('08:00'));
  await store.arrive(saved, at('08:00'));
  assert.equal(user.workStatus.code, 'trip');
});

test('later finance arrival evidence reconciles once and a provider replay preserves it', async () => {
  const { store } = setup({ finishedAt: undefined, destination: undefined, purpose: 'unknown' });
  const enriched = await store.saveFinance('return', { totalMinor: 20000, finishedAt: at('02:20'), destination: { address: 'Владивосток, Алеутская, 1' } });
  await store.arrive(enriched, at('08:00'));
  assert.equal(user.workStatus.code, 'office');
  assert.equal(userWrites, 1);
  const replay = await store.saveTrip({ externalId: 'return', externalUserId: 'external', status: 'complete', purpose: 'unknown', finishedAt: undefined, destination: undefined }, {}, at('08:01'));
  await store.arrive(replay, at('08:01'));
  assert.equal(replay.finishedAt.toISOString(), at('02:20').toISOString());
  assert.equal(userWrites, 1);
});

test('retry after interruption between user and trip writes converges without rewriting presence', async () => {
  const { store, returning } = setup();
  failMarker = true;
  await assert.rejects(store.arrive(returning, at('02:21')), /interrupted/);
  assert.equal(user.workStatus.code, 'office');
  assert.equal(userWrites, 1);
  failMarker = false;
  await store.arrive(returning, at('08:00'));
  assert.ok(trips.get('return').officeArrivalAppliedAt);
  assert.equal(userWrites, 1);
  await store.arrive(returning, at('08:01'));
  assert.equal(userWrites, 1);
});

const syncStore = (store) => ({ ...store, heartbeat: async () => {}, existingActive: async () => [],
  saveEmployees: async () => {}, pending: async () => [], pendingFinance: async () => [],
  markFinancePending: async () => {}, complete: async () => {} });

test('all operational trips are stored before an earlier return can override presence', async () => {
  const { store } = setup();
  const provider = async (path) => {
    if (path === '/users') return { items: [] };
    if (path === '/orders/list') return { items: [
      { id: 'return', user_id: 'external', status: 'complete' },
      { id: 'newer', user_id: 'external', status: 'complete', due_date: at('03:00').toISOString() },
    ], total_amount: 2 };
    throw new Error('report unavailable');
  };
  await syncOnce({ settings: { clientId: 'corp' }, provider, store: syncStore(store), now: at('08:00') });
  assert.equal(user.workStatus.code, 'trip');
  assert.equal(userWrites, 0);
});

test('all finance rows enrich chronology before an earlier return can override presence', async () => {
  const { store } = setup();
  trips.set('newer', { _id: 'newer', externalId: 'newer', externalUserId: 'external', userId: 'user', clientId: 'corp', status: 'complete', purpose: 'personal', manuallyAssigned: true });
  const provider = async (path) => {
    if (path === '/users') return { items: [] };
    if (path === '/orders/list') return { items: [
      { id: 'return', user_id: 'external', status: 'complete' },
      { id: 'newer', user_id: 'external', status: 'complete' },
    ], total_amount: 2 };
    if (path === '/orders/taxi/report') return { orders: [
      { id: 'return', total_cost: 200, finish_datetime: at('02:20').toISOString() },
      { id: 'newer', total_cost: 200, start_datetime: at('03:00').toISOString(), finish_datetime: at('03:20').toISOString() },
    ] };
    throw new Error(path);
  };
  await syncOnce({ settings: { clientId: 'corp' }, provider, store: syncStore(store), now: at('08:00') });
  assert.equal(user.workStatus.code, 'trip');
  assert.equal(userWrites, 0);
});

test('an observed completion survives an interrupted run outside the history window', async () => {
  const { store } = setup({ status: 'transporting', finishedAt: undefined });
  await store.saveTrip({ externalId: 'return', externalUserId: 'external', status: 'finished', purpose: 'unknown' }, {}, at('02:20'));
  assert.equal(trips.get('return').officeArrivalPending, true);
  const provider = async (path) => {
    if (path === '/users') return { items: [] };
    if (path === '/orders/list') return { items: [], total_amount: 0 };
    throw new Error(path);
  };
  const restarted = createStore({ clientId: 'corp', internalCompanyId: 'office' }, 'lease');
  await syncOnce({ settings: { clientId: 'corp' }, provider, store: syncStore(restarted), now: at('08:00') });
  assert.equal(user.workStatus.code, 'office');
  assert.equal(trips.get('return').officeArrivalPending, false);
  assert.ok(trips.get('return').officeArrivalAppliedAt);
  assert.deepEqual(await restarted.pendingArrivals(), []);
});

test('a non-office completion is consumed and later finance can still establish a genuine office arrival', async () => {
  const { store } = setup({ status: 'transporting', finishedAt: undefined, destination: undefined, purpose: 'unknown' });
  const saved = await store.saveTrip({ externalId: 'return', externalUserId: 'external', status: 'finished', purpose: 'unknown' }, {}, at('02:20'));
  await store.arrive(saved, at('02:21'));
  assert.equal(user.workStatus.code, 'trip');
  assert.equal(trips.get('return').officeArrivalPending, false);
  const enriched = await store.saveFinance('return', { totalMinor: 20000, destination: { address: 'Владивосток, Алеутская, 1' } });
  await store.arrive(enriched, at('08:00'));
  assert.equal(user.workStatus.code, 'office');
});

test('a future scheduled order and an earlier actual start do not block the current office arrival', async () => {
  for (const times of [
    { requestedAt: at('09:00'), status: 'searching' },
    { requestedAt: at('03:00'), startedAt: at('01:30'), status: 'complete' },
  ]) {
    const { store, returning } = setup();
    trips.set('scheduled', { _id: 'scheduled', userId: 'user', ...times });
    await store.arrive(returning, at('08:00'));
    assert.equal(user.workStatus.code, 'office', JSON.stringify(times));
  }
});

test('arrival enrichment saved before an interrupted run is retried outside the history window', async () => {
  const { store } = setup({ finishedAt: undefined, destination: undefined, purpose: 'unknown' });
  await store.saveFinance('return', { totalMinor: 20000, finishedAt: at('02:20'), destination: { address: 'Владивосток, Алеутская, 1' } });
  const provider = async (path) => {
    if (path === '/users') return { items: [] };
    if (path === '/orders/list') return { items: [], total_amount: 0 };
    throw new Error(path);
  };
  const restarted = createStore({ clientId: 'corp', internalCompanyId: 'office' }, 'lease');
  await syncOnce({ settings: { clientId: 'corp' }, provider, store: syncStore(restarted), now: at('08:00') });
  assert.equal(user.workStatus.code, 'office');
  assert.equal(trips.get('return').officeArrivalPending, false);
});

const { createOfficeArrival } = require('./office-arrival');
const withAnnouncement = (announceOfficeArrival) => createOfficeArrival({
  ...require('../../models/taxi'), User: require('../../models/user'),
  internalCompanyId: 'office', destinationCompany: async () => ({ companyId: 'office' }),
  announceOfficeArrival,
});

test('an accepted office transition announces once with the employee name and accepted status', async () => {
  const { returning } = setup();
  user.firstName = 'Василий'; user.lastName = 'Юшин';
  const calls = [];
  const arrive = withAnnouncement(async (trip, employee, now) => {
    assert.equal(user.workStatus.code, 'office', 'presence must be stored before announcing');
    assert.equal(trips.get('return').officeArrivalAppliedAt, undefined, 'completion marker follows the outbox');
    calls.push({ trip, employee, now });
  });
  await arrive(returning, at('02:21'));
  await arrive(returning, at('02:22'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].trip._id, 'return');
  assert.equal(calls[0].employee.firstName, 'Василий');
  assert.equal(calls[0].employee.lastName, 'Юшин');
  assert.equal(calls[0].employee.workStatus.code, 'office');
  assert.equal(calls[0].now.toISOString(), at('02:21').toISOString());
});

test('a failed office announcement retries after the user write without applying presence twice', async () => {
  const { returning } = setup({ officeArrivalPending: true });
  const outbox = new Map(); let unavailable = true;
  const arrive = withAnnouncement(async (trip) => {
    if (unavailable) throw new Error('outbox unavailable');
    if (!outbox.has(trip._id)) outbox.set(trip._id, 'вернулся в офис');
  });
  await assert.rejects(arrive(returning, at('02:21')), /outbox unavailable/);
  assert.equal(user.workStatus.code, 'office');
  assert.equal(userWrites, 1);
  assert.equal(trips.get('return').officeArrivalAppliedAt, undefined);
  assert.equal(trips.get('return').officeArrivalPending, true);
  unavailable = false;
  await arrive(returning, at('02:22'));
  await arrive(returning, at('02:23'));
  assert.equal(userWrites, 1);
  assert.equal(outbox.size, 1);
  assert.ok(trips.get('return').officeArrivalAppliedAt);
  assert.equal(trips.get('return').officeArrivalPending, false);
});

test('a marker failure retries the same office outbox event without duplicate notification', async () => {
  const { returning } = setup({ officeArrivalPending: true });
  const outbox = new Map(); let calls = 0;
  const arrive = withAnnouncement(async (trip) => {
    calls++;
    if (!outbox.has(trip._id)) outbox.set(trip._id, 'вернулся в офис');
  });
  failMarker = true;
  await assert.rejects(arrive(returning, at('02:21')), /interrupted/);
  assert.equal(userWrites, 1);
  assert.equal(outbox.size, 1);
  failMarker = false;
  await arrive(returning, at('02:22'));
  assert.equal(calls, 2);
  assert.equal(outbox.size, 1);
  assert.equal(userWrites, 1);
  assert.ok(trips.get('return').officeArrivalAppliedAt);
});

test('a business trip assigned to an external client in the office building is never an office return', async () => {
  const { returning } = setup({ purpose: 'business', companyId: 'client', manuallyAssigned: true });
  sharedOffice = true;
  let calls = 0;
  await withAnnouncement(async () => { calls++; })(returning, at('02:21'));
  assert.equal(user.workStatus.code, 'trip');
  assert.equal(user.workStatus.taxiTripId, 'outbound');
  assert.equal(userWrites, 0);
  assert.equal(calls, 0);
});

test('manual changes and newer journeys suppress an interrupted office announcement', async () => {
  for (const manual of [true, false]) {
    const { returning } = setup({ officeArrivalPending: true });
    const outbox = new Map(); let unavailable = true;
    const arrive = withAnnouncement(async (trip) => {
      if (unavailable) throw new Error('outbox unavailable');
      outbox.set(trip._id, 'вернулся в офис');
    });
    await assert.rejects(arrive(returning, at('02:21')), /outbox unavailable/);
    if (manual) user.workStatus = { source: 'manual', code: 'remote', updatedAt: at('02:22') };
    else trips.set('newer', { _id: 'newer', userId: 'user', purpose: 'personal', status: 'transporting', startedAt: at('02:22') });
    unavailable = false;
    await arrive(returning, at('02:23'));
    assert.equal(outbox.size, 0);
    assert.equal(userWrites, 1);
  }
});

test('createStore sends the accepted office arrival to the configured Telegram topic once', async () => {
  const { store, returning } = setup();
  user.firstName = 'Василий'; user.lastName = 'Юшин';
  telegramPreferences = { notify: { byTelegram: { isActive: true, sendToGroup: true, chatId: '-100', messageThreadId: 321 } } };
  notificationOutbox = new Map();
  await store.arrive(returning, at('02:21'));
  await store.arrive(returning, at('02:22'));
  assert.equal(user.workStatus.code, 'office');
  assert.equal(userWrites, 1);
  assert.equal(notificationOutbox.size, 1);
  assert.equal(notificationWrites, 1);
  const [[eventId, notice]] = notificationOutbox;
  assert.match(eventId, /^[a-f\d]{24}$/);
  assert.notEqual(eventId, returning._id, 'office arrival has its own event key');
  assert.deepEqual(notice, {
    instrument: 'telegram', to: { chatId: '-100', globalChat: true, messageThreadId: 321 },
    title: 'Возвращение в офис', text: '🏢 Василий Юшин снова в офисе',
  });
});

test('createStore recovers a lost office outbox response without duplicate Telegram or presence writes', async () => {
  const { store, returning } = setup({ officeArrivalPending: true });
  user.firstName = 'Василий'; user.lastName = 'Юшин';
  telegramPreferences = { notify: { byTelegram: { isActive: true, sendToGroup: true, chatId: '-100', messageThreadId: 321 } } };
  notificationOutbox = new Map(); loseOutboxResponse = true;
  await assert.rejects(store.arrive(returning, at('02:21')), /outbox response lost/);
  assert.equal(user.workStatus.code, 'office');
  assert.equal(trips.get('return').officeArrivalAppliedAt, undefined);
  assert.equal(trips.get('return').officeArrivalPending, true);
  assert.equal(notificationOutbox.size, 1);
  const firstEventId = [...notificationOutbox.keys()][0];
  const restarted = createStore({ clientId: 'corp', internalCompanyId: 'office' }, 'lease');
  await restarted.arrive(returning, at('02:22'));
  await restarted.arrive(returning, at('02:23'));
  assert.equal(notificationOutbox.size, 1);
  assert.equal([...notificationOutbox.keys()][0], firstEventId);
  assert.equal(notificationWrites, 2, 'one initial insert and one idempotent retry');
  assert.equal(userWrites, 1);
  assert.ok(trips.get('return').officeArrivalAppliedAt);
  assert.equal(trips.get('return').officeArrivalPending, false);
});

test('finance finish enrichment preserves recovery of an office notification after observed completion', async () => {
  const { store } = setup({ status: 'transporting', finishedAt: undefined });
  user.firstName = 'Василий'; user.lastName = 'Юшин';
  telegramPreferences = { notify: { byTelegram: { isActive: true, sendToGroup: true, chatId: '-100', messageThreadId: 321 } } };
  notificationOutbox = new Map(); failOutboxWrite = true;
  const completed = await store.saveTrip({ externalId: 'return', externalUserId: 'external', status: 'complete', purpose: 'unknown' }, {}, at('02:21'));
  await assert.rejects(store.arrive(completed, at('02:21')), /outbox write unavailable/);
  assert.equal(user.workStatus.code, 'office');
  assert.equal(user.workStatus.updatedAt.toISOString(), at('02:21').toISOString());
  assert.equal(trips.get('return').officeArrivalAppliedAt, undefined);
  assert.equal(trips.get('return').officeArrivalPending, true);
  assert.equal(notificationOutbox.size, 0);
  const enriched = await store.saveFinance('return', { totalMinor: 20000, finishedAt: at('02:20') });
  failOutboxWrite = false;
  const restarted = createStore({ clientId: 'corp', internalCompanyId: 'office' }, 'lease');
  await restarted.arrive(enriched, at('02:22'));
  await restarted.arrive(enriched, at('02:23'));
  assert.equal(userWrites, 1);
  assert.equal(notificationOutbox.size, 1);
  assert.equal([...notificationOutbox.values()][0].text, '🏢 Василий Юшин снова в офисе');
  assert.ok(trips.get('return').officeArrivalAppliedAt);
  assert.equal(trips.get('return').officeArrivalPending, false);
});
