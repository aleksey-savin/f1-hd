const { Types } = require('mongoose');
const { TaxiTrip } = require('../../models/taxi');
const { AppError } = require('../../middleware/errorHandling');
const { assertTicketsAccessible } = require('../ticketAccess');
const { validateWorkTrip } = require('./policy');

const validateWorkTaxiLinks = async ({ auth, work, taxiTripIds }) => {
  if (taxiTripIds === undefined) return undefined;
  if (!Array.isArray(taxiTripIds) || taxiTripIds.some((id) => !Types.ObjectId.isValid(String(id)))) {
    throw new AppError('Некорректные поездки', 400);
  }
  const ids = [...new Set(taxiTripIds.map(String))];
  if (!ids.length) return [];
  if (!auth?.userId || auth.isEndUser) throw new AppError('Недостаточно прав', 403);
  const tickets = await assertTicketsAccessible(auth, work.tickets);
  if (tickets.some((ticket) => String(ticket.company?._id ?? ticket.company ?? '') !== String(work.company?._id ?? work.company ?? ''))) {
    throw new AppError('Компания заявки не соответствует работе', 400);
  }
  const trips = await TaxiTrip.find({ _id: { $in: ids }, deletedAt: null }).lean();
  if (trips.length !== ids.length) throw new AppError('Поездка не найдена', 404);
  for (const trip of trips) validateWorkTrip(work, trip, {
    userId: auth.userId,
    canAllocate: auth.can({ taxi: ['allocate'] }),
  });
  return ids;
};
const { runTaxiSync } = require('./sync');
module.exports = { validateWorkTaxiLinks, runTaxiSync };
