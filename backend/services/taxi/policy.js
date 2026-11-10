const ACTIVE_STATUSES = ['transporting'];
const normalizePurpose = (purpose) => purpose === 'home' ? 'personal' : purpose;
const companyPurpose = (companyId, internalCompanyId) => !companyId ? 'unknown'
  : internalCompanyId && String(companyId) === String(internalCompanyId) ? 'service' : 'business';
const isWorkPurpose = (purpose) => ['business', 'service'].includes(purpose);
const isTaxiPresence = (user) => Boolean(
  user?.workStatus?.code === 'trip' &&
  user.workStatus.source === 'taxi' &&
  user.workStatus.taxiTripId,
);

const shouldApplyPresence = (trip) => Boolean(
  !trip?.deletedAt && trip?.purpose === 'business' && trip.status === 'transporting' &&
  trip.userId && !trip.historical,
);
const SUCCESSFUL_STATUSES = ['complete', 'finished'];
const CANCELLED_STATUSES = ['cancelled', 'canceled', 'client_cancelled', 'driver_cancelled', 'failed'];
const shouldCheckOfficeArrival = (trip) => Boolean(
  trip && !trip.deletedAt && !trip.historical && !trip.officeArrivalAppliedAt &&
  ['business', 'service', 'unknown'].includes(trip.purpose) && SUCCESSFUL_STATUSES.includes(trip.status) && trip.userId,
);
const officeArrivalStatus = (trip, user, previousTrip, now) => {
  if (!shouldCheckOfficeArrival(trip) || !isTaxiPresence(user)) return null;
  const arrival = new Date(trip.finishedAt || trip.officeArrivalObservedAt);
  const start = new Date(trip.startedAt || trip.requestedAt);
  const previousStart = new Date(previousTrip?.startedAt || previousTrip?.requestedAt);
  const statusAt = new Date(user.workStatus.updatedAt);
  if (![arrival, start, previousStart, statusAt].every((date) => Number.isFinite(date.valueOf())) ||
    arrival > now || arrival < start || previousStart >= start || statusAt > start ||
    !previousTrip || previousTrip.deletedAt || previousTrip.purpose !== 'business' ||
    String(previousTrip.userId) !== String(trip.userId) || String(previousTrip._id) === String(trip._id) ||
    previousTrip.finishedAt && new Date(previousTrip.finishedAt) > start) return null;
  return { code: 'office', note: '', source: 'taxi', auto: false, updatedAt: arrival };
};

const moneyToMinor = (value) => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Некорректная сумма провайдера');
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Некорректная сумма провайдера');
  return Number(minor);
};
const { AppError } = require('../../middleware/errorHandling');
const id = (value) => String(value?._id ?? value ?? '');
const validateWorkTrip = (work, trip, actor) => {
  if (!work.visitRequired || !work.finishedAt || !work.startedAt && work.scheduled) {
    throw new AppError('Поездку можно связать только с фактическим выездом', 400);
  }
  if (trip.deletedAt || !isWorkPurpose(trip.purpose) || !id(work.company) || id(work.company) !== id(trip.companyId)) {
    throw new AppError('Компания или цель поездки не соответствует работе', 400);
  }
  if (!actor.canAllocate && (id(trip.userId) !== id(actor.userId) || id(work.finishedBy) !== id(actor.userId))) {
    throw new AppError('Недостаточно прав для связи поездки', 403);
  }
};
module.exports = { ACTIVE_STATUSES, SUCCESSFUL_STATUSES, CANCELLED_STATUSES, isTaxiPresence, shouldApplyPresence, shouldCheckOfficeArrival, officeArrivalStatus, moneyToMinor, validateWorkTrip, normalizePurpose, companyPurpose, isWorkPurpose };
