const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const historyStart = (now, days, zone) => {
  const today = dayjs(now).tz(zone).format('YYYY-MM-DD');
  const startDate = dayjs.utc(today).subtract(days, 'day').format('YYYY-MM-DD');
  return dayjs.tz(startDate, zone).utc().toISOString();
};
const { AppError } = require('../../middleware/errorHandling');
const { parseOrder, parseFinance, parseEmployee, collectPages, collectEmployees } = require('./import');
const { shouldApplyPresence, shouldCheckOfficeArrival, SUCCESSFUL_STATUSES, CANCELLED_STATUSES, normalizePurpose, companyPurpose } = require('./policy');
const { taxiPresenceNote } = require('./presentation');

const syncOnce = async ({ settings, provider, store, now = new Date() }) => {
  const call = async (path, options) => { await store.heartbeat(); return provider(path, options); };
  const employees = await collectEmployees((cursor) => call('/users', { query: { limit: 100, cursor } }));
  const since = historyStart(now, settings.historyDays || 14, settings.timezone || 'Europe/Moscow');
  const rows = await collectPages((offset, limit) => call('/orders/list', { query: { offset, limit, since_datetime: since, till_datetime: now.toISOString(), sorting_field: 'due_date', sorting_direction: 1 } }));
  const byId = new Map();
  for (const row of rows) {
    const parsed = parseOrder(row);
    if (byId.has(parsed.externalId)) throw new AppError('Повтор поездки в ответе Яндекс Go', 502);
    byId.set(parsed.externalId, { row, parsed });
  }
  for (const active of await store.existingActive()) {
    if (byId.has(active.externalId)) continue;
    const row = await call('/orders/info', { query: { order_id: active.externalId } });
    const parsed = parseOrder(row);
    if (parsed.externalId !== active.externalId) throw new AppError('Некорректный ответ Яндекс Go', 502);
    byId.set(parsed.externalId, { row, parsed });
  }
  // A list entry alone may be stale; check live state immediately before presence.
  for (const [id, entry] of byId) {
    if (entry.parsed.status !== 'transporting') continue;
    const fresh = await call('/orders/info', { query: { order_id: id } });
    const parsed = parseOrder(fresh);
    if (parsed.externalId !== id) throw new AppError('Некорректный ответ Яндекс Go', 502);
    byId.set(id, { row: fresh, parsed });
  }
  await store.heartbeat();
  await store.saveEmployees(employees);
  const visibleIds = new Set();
  const savedTrips = [];
  for (const { row, parsed } of byId.values()) {
    await store.heartbeat();
    const saved = await store.saveTrip(parsed, row, now);
    if (saved?.deletedAt) continue;
    visibleIds.add(parsed.externalId);
    savedTrips.push(saved);
  }
  for (const saved of savedTrips) {
    if (shouldApplyPresence(saved)) await store.live(saved, now);
  }
  for (const pending of await store.pending?.() || []) {
    await store.heartbeat();
    await store.live(pending, now);
  }
  const terminal = new Set(['complete', 'finished', 'cancelled', 'client_cancelled', 'driver_cancelled', 'failed']);
  const ids = [...new Set([...byId.entries()].filter(([id, entry]) => visibleIds.has(id) && terminal.has(entry.parsed.status)).map(([id]) => id).concat((await store.pendingFinance?.() || []).map((trip) => trip.externalId)))];
  let financialPending = false;
  let financialError = '';
  const enrichedTrips = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    await store.heartbeat();
    await store.markFinancePending?.(batch);
    let report;
    try { report = await provider('/orders/taxi/report', { method: 'POST', body: { ids: batch } }); }
    catch (error) {
      financialPending = true;
      financialError = error instanceof AppError
        ? `Не удалось загрузить финансовый отчёт: ${error.message}`
        : 'Не удалось загрузить финансовый отчёт Яндекс Go';
      continue;
    }
    const reportRows = Array.isArray(report) ? report : (report?.orders ?? report?.items);
    if (!Array.isArray(reportRows)) { financialPending = true; financialError = 'Некорректный финансовый отчёт Яндекс Go'; continue; }
    const seen = new Set();
    for (const row of reportRows) {
      if (!row || typeof row.id !== 'string' || !batch.includes(row.id) || seen.has(row.id)) { financialPending = true; financialError = 'Некорректный финансовый отчёт Яндекс Go'; continue; }
      seen.add(row.id);
      let financial;
      try { financial = parseFinance(row); } catch { financialPending = true; financialError = 'Некорректные данные в финансовом отчёте Яндекс Go'; continue; }
      if (financial.totalMinor === undefined) { financialPending = true; continue; }
      await store.heartbeat();
      const enriched = await store.saveFinance(row.id, financial);
      if (enriched) enrichedTrips.push(enriched);
    }
    if (seen.size !== batch.length) financialPending = true;
  }
  // Both operational rows and finance can reveal a later journey. Reconcile
  // arrivals only after the full batch is stored, including failed-report runs.
  const arrivals = new Map();
  for (const trip of [...savedTrips, ...enrichedTrips, ...(await store.pendingArrivals?.() || [])]) {
    if (shouldCheckOfficeArrival(trip) || trip?.officeArrivalPending) arrivals.set(String(trip._id || trip.externalId), trip);
  }
  for (const trip of arrivals.values()) {
    await store.heartbeat();
    await store.arrive?.(trip, now);
  }
  await store.complete(now, { financialPending, financialError });
  return { imported: visibleIds.size, financialPending, financialError };
};

module.exports = { syncOnce };

const createStore = (settings, leaseToken) => {
  const { TaxiSettings, TaxiEmployee, TaxiTrip } = require('../../models/taxi');
  const User = require('../../models/user');
  const Company = require('../../models/company');
  const Subdivision = require('../../models/subdivision');
  const Work = require('../../models/work');
  const { destinationIndex, matchDestination } = require('./destination');
  const Preferences = require('../../models/preferences');
  const Notification = require('../../models/notification');
  const { createTaxiNotifications } = require('./notifications');
  const notifications = createTaxiNotifications({ Notification, Preferences });
  const leaseFilter = { _id: 'yandex-business', leaseToken, clientId: settings.clientId, token: settings.token };
  const heartbeat = async () => {
    const result = await TaxiSettings.updateOne({ ...leaseFilter, leaseUntil: { $gt: new Date() }, isActive: true }, { $set: { leaseUntil: new Date(Date.now() + 120000) } });
    if (!result.matchedCount) throw new AppError('Аренда синхронизации такси истекла', 409);
  };
  const saveEmployees = async (rows) => {
    for (const row of rows) {
      await heartbeat();
      await TaxiEmployee.updateOne({ externalId: row.id }, { $set: parseEmployee(row), $setOnInsert: { externalId: row.id } }, { upsert: true });
    }
  };
  let addresses;
  const destinationCompany = async (trip, onlyCompanyId) => {
    if (!trip.destination?.address && trip.destination?.lat == null && trip.destination?.lon == null) return null;
    if (!addresses) addresses = (async () => {
      const companies = await Company.find({ isActive: { $ne: false } }).select('address location isActive').lean();
      const subdivisions = await Subdivision.find({ company: { $in: companies.map((company) => company._id) } }).select('company address location').lean();
      return destinationIndex(companies, subdivisions);
    })();
    const entries = await addresses;
    return matchDestination(trip.destination, onlyCompanyId ? entries.filter((entry) => String(entry.companyId) === String(onlyCompanyId)) : entries);
  };
  const { createOfficeArrival } = require('./office-arrival');
  const arrive = createOfficeArrival({ TaxiTrip, TaxiEmployee, User,
    destinationCompany: (trip) => destinationCompany(trip, settings.internalCompanyId), internalCompanyId: settings.internalCompanyId,
    announceOfficeArrival: notifications.officeArrival });
  const attributeTrip = async (filter, current, purpose) => {
    if (current.deletedAt || current.manuallyAssigned) return current;
    purpose = normalizePurpose(purpose);
    if (purpose === 'unknown' && normalizePurpose(current.purpose) === 'personal') purpose = 'personal';
    const match = !current.companyId || current.companyMatch || purpose === 'unknown' ? await destinationCompany(current) : null;
    const companyId = match?.companyId;
    // Human-confirmed work associations must not be moved to another client
    // by a later route/catalogue change.
    if (current.companyMatch && String(current.companyId || '') !== String(companyId || '') && await Work.exists({ taxiTripIds: current._id })) {
      if (current.presenceAppliedAt) await refreshTaxiPresenceNote(current);
      return current;
    }
    if (purpose === 'unknown' && match && (!current.companyId || current.companyMatch || String(current.companyId) === match.companyId)) purpose = companyPurpose(match.companyId, settings.internalCompanyId);
    const automatic = !current.companyId || current.companyMatch;
    await TaxiTrip.updateOne({ ...filter, manuallyAssigned: { $ne: true }, companyId: current.companyId || null }, { $set: {
      purpose,
      ...(automatic ? { companyId: companyId || null, companyMatch: match?.method || null } : {}),
    } });
    const updated = await TaxiTrip.findOne(filter).lean();
    if (current.presenceAppliedAt) await refreshTaxiPresenceNote(updated);
    return updated;
  };
  const saveTrip = async (parsed, _row, now = new Date()) => {
    const employee = await TaxiEmployee.findOne({ externalId: parsed.externalUserId }).lean();
    const { purpose, externalId, ...providerFields } = parsed;
    const filter = { clientId: settings.clientId, externalId };
    const before = await TaxiTrip.findOne(filter).lean();
    const observedArrival = before && !before.deletedAt && !before.officeArrivalObservedAt &&
      before.status && ![...SUCCESSFUL_STATUSES, ...CANCELLED_STATUSES].includes(before.status) && SUCCESSFUL_STATUSES.includes(parsed.status);
    await TaxiTrip.updateOne(filter, { $set: {
      ...Object.fromEntries(Object.entries(providerFields).filter(([, value]) => value !== undefined)),
      ...(employee?.userId ? { userId: employee.userId } : {}), lastSyncedAt: now,
      ...(observedArrival ? { officeArrivalObservedAt: now, officeArrivalPending: true } : {}),
    }, $setOnInsert: { ...filter, source: 'go' } }, { upsert: true });
    const current = await TaxiTrip.findOne(filter).lean();
    if (current.deletedAt || current.manuallyAssigned) return current;
    return attributeTrip(filter, current, purpose);
  };
  const live = async (trip, now) => {
    if (trip.deletedAt) return;
    const claimed = await TaxiTrip.findOneAndUpdate({ _id: trip._id, deletedAt: null, presenceAppliedAt: null, purpose: 'business', status: 'transporting' }, { $set: { presenceAppliedAt: now, startedAt: trip.startedAt || now } }, { new: true }).lean();
    const current = claimed || await TaxiTrip.findById(trip._id).lean();
    if (!current || current.deletedAt || current.purpose !== 'business') return;
    trip = current;
    const appliedAt = current.presenceAppliedAt;
    if (!appliedAt) return;
    // Recover a recent interrupted outbox write, but never announce yesterday's
    // departure as current after a prolonged outage/restart.
    if (now.valueOf() - new Date(appliedAt).valueOf() > 15 * 60000) {
      await TaxiTrip.updateOne({ _id: trip._id, announcementClaimedAt: null }, { $set: { announcementClaimedAt: now } });
      return;
    }
    const [user, company] = await Promise.all([
      User.findById(trip.userId).select('firstName lastName isEndUser isServiceAccount isCloudTelephony hideWorkStatus deletedAt banned workStatus').lean(),
      trip.companyId ? Company.findById(trip.companyId).select('alias').lean() : null,
    ]);
    if (!user || user.deletedAt || user.isEndUser !== false || user.banned || user.isServiceAccount || user.isCloudTelephony || user.hideWorkStatus) return;
    const note = taxiPresenceNote(company?.alias, trip.destination?.address);
    const presence = await User.updateOne({ _id: user._id, $or: [
      { 'workStatus.updatedAt': { $lte: appliedAt } },
      { 'workStatus.updatedAt': null },
      { 'workStatus.source': 'taxi', 'workStatus.taxiTripId': trip._id },
    ] }, { $set: { workStatus: { code: 'trip', note, source: 'taxi', taxiTripId: trip._id, auto: false, updatedAt: appliedAt } } });
    if (presence.matchedCount && !trip.announcementClaimedAt) await notifications.departure(trip, user, company?.alias, now);
    if (!trip.announcementClaimedAt) await TaxiTrip.updateOne({ _id: trip._id, announcementClaimedAt: null }, { $set: { announcementClaimedAt: now } });
  };
  return {
    heartbeat, saveEmployees, saveTrip, live, arrive,
    saveFinance: async (externalId, financial) => {
      const filter = { clientId: settings.clientId, externalId, deletedAt: null };
      // Commit arrival recovery together with finance: a crash before the
      // batch's presence phase must not lose an out-of-window return.
      await TaxiTrip.updateOne(filter, { $set: { ...financial, financialPending: false, officeArrivalPending: true } });
      const current = await TaxiTrip.findOne(filter).lean();
      return current ? attributeTrip(filter, current, current.purpose) : null;
    },
    markFinancePending: (ids) => TaxiTrip.updateMany({ clientId: settings.clientId, deletedAt: null, externalId: { $in: ids } }, { $set: { financialPending: true } }),
    pendingFinance: () => TaxiTrip.find({ clientId: settings.clientId, deletedAt: null, financialPending: true, status: { $in: ['complete', 'finished', 'cancelled', 'client_cancelled', 'driver_cancelled', 'failed'] } }).select('externalId').limit(10001).lean().then((rows) => {
      if (rows.length > 10000) throw new AppError('Слишком много поездок для финансовой сверки', 502);
      return rows;
    }),
    pending: () => TaxiTrip.find({ clientId: settings.clientId, deletedAt: null, presenceAppliedAt: { $ne: null }, announcementClaimedAt: null }).limit(10001).lean().then((rows) => {
      if (rows.length > 10000) throw new AppError('Слишком много необработанных поездок', 502);
      return rows;
    }),
    pendingArrivals: () => TaxiTrip.find({ clientId: settings.clientId, deletedAt: null, officeArrivalPending: true, status: { $in: SUCCESSFUL_STATUSES } }).limit(10001).lean().then((rows) => {
      if (rows.length > 10000) throw new AppError('Слишком много необработанных прибытий', 502);
      return rows;
    }),
    existingActive: () => TaxiTrip.find({ clientId: settings.clientId, deletedAt: null, status: { $nin: ['complete', 'finished', 'cancelled', 'canceled', 'client_cancelled', 'driver_cancelled', 'failed'] } }).select('externalId').limit(10001).lean().then((rows) => {
      if (rows.length > 10000) throw new AppError('Слишком много активных поездок', 502);
      return rows;
    }),
    complete: async (now, { financialPending, financialError }) => {
      await heartbeat();
      const result = await TaxiSettings.updateOne(leaseFilter, { $set: { lastSyncAt: now, 'health.lastOkAt': now, 'health.lastError': '', 'health.financialPending': financialPending, 'health.financialError': financialError, 'health.consecutiveFailures': 0 } });
      if (!result.matchedCount) throw new AppError('Аренда синхронизации такси истекла', 409);
    },
  };
};

const runTaxiSync = async ({ force = false } = {}) => {
  const crypto = require('crypto');
  const { TaxiSettings } = require('../../models/taxi');
  const { decryptSecret } = require('../crypto/secretBox');
  const { request } = require('./provider');
  const now = new Date();
  const settings = await TaxiSettings.findById('yandex-business').select('+token').lean();
  if (!settings?.isActive || !settings.clientId || !settings.token) return { imported: 0, skipped: true, message: 'Синхронизация недоступна: включите и настройте корпоративное такси' };
  if (!force && settings.lastSyncAt && now - new Date(settings.lastSyncAt) < (settings.pollSeconds || 60) * 1000) return { imported: 0, skipped: true, message: 'Данные уже обновлены; следующий запуск по расписанию' };
  const token = crypto.randomUUID();
  const claimed = await TaxiSettings.findOneAndUpdate({ _id: 'yandex-business', isActive: true, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }, { $set: { leaseToken: token, leaseUntil: new Date(now.getTime() + 120000) } }, { new: true });
  if (!claimed) return { imported: 0, skipped: true, message: 'Синхронизация уже выполняется; дождитесь завершения' };
  try {
    let secret;
    try { secret = decryptSecret(settings.token); } catch { throw new AppError('Токен Яндекс Go недоступен; проверьте ключ шифрования', 400); }
    const Preferences = require('../../models/preferences');
    const preferences = await Preferences.findOne({}).select('timezone defaultCompany').lean();
    settings.timezone = preferences?.timezone || 'Europe/Moscow';
    settings.internalCompanyId = preferences?.defaultCompany?._id;
    const provider = (path, options) => request({ token: secret, clientId: settings.clientId }, path, options);
    return await syncOnce({ settings, provider, store: createStore(settings, token), now });
  } catch (error) {
    await TaxiSettings.updateOne({ _id: 'yandex-business', leaseToken: token }, { $set: { 'health.lastErrorAt': new Date(), 'health.lastError': 'Не удалось синхронизировать Яндекс Go' }, $inc: { 'health.consecutiveFailures': 1 } });
    throw error;
  } finally {
    await TaxiSettings.updateOne({ _id: 'yandex-business', leaseToken: token }, { $set: { leaseUntil: null, leaseToken: null } });
  }
};
const refreshTaxiPresenceNote = async (trip) => {
  if (!trip?.userId || !trip._id || trip.deletedAt) return;
  const User = require('../../models/user');
  const Company = require('../../models/company');
  const company = trip.companyId ? await Company.findById(trip.companyId).select('alias').lean() : null;
  const note = taxiPresenceNote(company?.alias, trip.destination?.address);
  await User.updateOne({ _id: trip.userId, 'workStatus.source': 'taxi', 'workStatus.taxiTripId': trip._id }, { $set: { 'workStatus.note': note } });
};
module.exports = { syncOnce, runTaxiSync, createStore, refreshTaxiPresenceNote, historyStart };
