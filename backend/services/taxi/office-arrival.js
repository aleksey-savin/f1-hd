const { CANCELLED_STATUSES, shouldCheckOfficeArrival, officeArrivalStatus } = require('./policy');

// Reconcile only a still taxi-owned client visit. Importing arbitrary history
// must never restore presence after a manual change or a later journey.
const createOfficeArrival = ({ TaxiTrip, TaxiEmployee, User, destinationCompany, internalCompanyId, announceOfficeArrival = async () => {} }) => {
  const hasNewerTrip = (trip, now) => {
    const start = new Date(trip.startedAt || trip.requestedAt);
    return TaxiTrip.exists({
      _id: { $ne: trip._id }, userId: trip.userId, deletedAt: null,
      status: { $nin: CANCELLED_STATUSES },
      $or: [
        { startedAt: { $gt: start, $lte: now } },
        { startedAt: null, requestedAt: { $gt: start, $lte: now } },
      ],
    });
  };
  const reconcile = async (input, now) => {
    if (!internalCompanyId || !shouldCheckOfficeArrival(input)) return;
    const trip = await TaxiTrip.findById(input._id).lean();
    if (!shouldCheckOfficeArrival(trip)) return;
    // A known client at the same building remains a client visit. Financially
    // unassigned shared-building returns may still match the actual office.
    if (trip.purpose === 'business' && trip.companyId && String(trip.companyId?._id || trip.companyId) !== String(internalCompanyId)) return;
    const match = await destinationCompany(trip);
    if (String(match?.companyId || '') !== String(internalCompanyId)) return;
    const [employee, user] = await Promise.all([
      TaxiEmployee.findOne({ externalId: trip.externalUserId, userId: trip.userId, active: { $ne: false } }).lean(),
      User.findById(trip.userId).select('firstName lastName isEndUser isServiceAccount isCloudTelephony hideWorkStatus deletedAt banned workStatus').lean(),
    ]);
    if (!employee || String(employee.userId) !== String(trip.userId) || employee.active === false || !user ||
      user.deletedAt || user.isEndUser !== false || user.banned || user.isServiceAccount || user.isCloudTelephony || user.hideWorkStatus) return;
    // A crash after the user write leaves no old trip link, but this exact
    // timestamp/source still identifies the completed reconciliation. Finance
    // can later replace the observed time with the provider's actual finish.
    const statusAt = new Date(user.workStatus?.updatedAt).valueOf();
    const matchesArrival = [trip.finishedAt, trip.officeArrivalObservedAt].some((value) => {
      const timestamp = value ? new Date(value).valueOf() : NaN;
      return Number.isFinite(timestamp) && timestamp === statusAt;
    });
    if (matchesArrival && user.workStatus?.code === 'office' && user.workStatus.source === 'taxi' &&
      !user.workStatus.taxiTripId) {
      if (await hasNewerTrip(trip, now)) return;
      await announceOfficeArrival(trip, user, now);
      await TaxiTrip.updateOne({ _id: trip._id, deletedAt: null }, { $set: { officeArrivalAppliedAt: now } });
      return;
    }
    if (!user.workStatus?.taxiTripId) return;
    const previousTrip = await TaxiTrip.findById(user.workStatus.taxiTripId).lean();
    const workStatus = officeArrivalStatus(trip, user, previousTrip, now);
    if (!workStatus) return;
    if (await hasNewerTrip(trip, now)) return;
    const result = await User.updateOne({
      _id: user._id, deletedAt: null, isEndUser: false, banned: { $ne: true },
      isServiceAccount: { $ne: true }, isCloudTelephony: { $ne: true }, hideWorkStatus: { $ne: true },
      'workStatus.code': 'trip', 'workStatus.source': 'taxi',
      'workStatus.taxiTripId': user.workStatus.taxiTripId, 'workStatus.updatedAt': user.workStatus.updatedAt,
    }, { $set: { workStatus } });
    if (result.matchedCount) {
      await announceOfficeArrival(trip, { ...user, workStatus }, now);
      await TaxiTrip.updateOne({ _id: trip._id, deletedAt: null }, { $set: { officeArrivalAppliedAt: now } });
    }
  };
  return async (trip, now = new Date()) => {
    await reconcile(trip, now);
    // No-op checks are consumed as well. Later finance enrichment explicitly
    // rechecks arrival; an exception leaves this flag available for recovery.
    if (trip?.officeArrivalPending) await TaxiTrip.updateOne({ _id: trip._id, deletedAt: null }, { $set: { officeArrivalPending: false } });
  };
};

module.exports = { createOfficeArrival };
