const { createHash } = require('crypto');
const { escapeHtml } = require('../telegramMessage');
const { formatTaxiAddress } = require('./presentation');
const MAX_NOTICE_AGE_MS = 15 * 60000;
const officeEventId = (tripId) => createHash('sha256').update(`taxi:office-arrival:${tripId}`).digest('hex').slice(0, 24);

const createTaxiNotifications = ({ Notification, Preferences }) => {
  const enqueue = async (event, trip, user, companyAlias, now = new Date()) => {
    const occurredAt = new Date(event === 'departure' ? trip.presenceAppliedAt : trip.finishedAt || trip.officeArrivalObservedAt);
    const age = now.valueOf() - occurredAt.valueOf();
    if (!Number.isFinite(age) || age < 0 || age > MAX_NOTICE_AGE_MS) return;
    const preferences = await Preferences.findOne({}).select('notify.byTelegram').lean();
    const group = preferences?.notify?.byTelegram;
    if (!group?.isActive || !group.sendToGroup || !group.chatId) return;
    const name = escapeHtml([user.firstName, user.lastName].filter(Boolean).join(' ') || 'Сотрудник');
    const departure = event === 'departure';
    await Notification.updateOne({ _id: departure ? trip._id : officeEventId(trip._id) }, { $setOnInsert: {
      instrument: 'telegram',
      to: { chatId: group.chatId, globalChat: true, ...(group.messageThreadId ? { messageThreadId: group.messageThreadId } : {}) },
      title: departure ? 'Поездка началась' : 'Возвращение в офис',
      text: departure
        ? `🚕 ${name} на выезде, компания ${escapeHtml(companyAlias || 'не указана')}, адрес ${escapeHtml(formatTaxiAddress(trip.destination?.address) || 'не указан')}`
        : `🏢 ${name} снова в офисе`,
    } }, { upsert: true });
  };
  return {
    departure: (trip, user, companyAlias, now) => enqueue('departure', trip, user, companyAlias, now),
    officeArrival: (trip, user, now) => enqueue('office', trip, user, null, now),
  };
};
module.exports = { createTaxiNotifications };
