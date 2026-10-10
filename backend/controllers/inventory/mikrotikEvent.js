// Журнал устройства Mikrotik: лента событий на странице записи. Пишет журнал services/mikrotik/events.js,
// что уходит наружу — services/mikrotik/eventView.js. Здесь только HTTP и чтение из базы.
const mongoose = require("mongoose");

const Mikrotik = require("../../models/mikrotik");
const MikrotikEvent = require("../../models/mikrotikEvent");
const User = require("../../models/user");
const Ticket = require("../../models/ticket");
const { AppError } = require("../../middleware/errorHandling");
const { clampLimit, parseGroup, encodeCursor, decodeCursor, olderThan, lookups, toView } = require("../../services/mikrotik/eventView");

const fullName = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(" ");

exports.listForRecord = async (req, res, next) => {
  try {
    const { recordId } = req.params;
    if (!mongoose.isValidObjectId(recordId) || !(await Mikrotik.exists({ _id: recordId }))) {
      return next(new AppError("Устройство не найдено", 404));
    }
    const limit = clampLimit(req.query.limit);
    const group = parseGroup(req.query.group);
    const scope = { mikrotik: recordId, ...(group ? { group } : {}) };

    const [rows, total] = await Promise.all([
      MikrotikEvent.find({ ...scope, ...olderThan(decodeCursor(req.query.before)) })
        .sort({ at: -1, _id: -1 })
        .limit(limit + 1)
        .lean(),
      MikrotikEvent.countDocuments(scope),
    ]);
    const page = rows.slice(0, limit);

    const wanted = lookups(page);
    const [users, tickets] = await Promise.all([
      wanted.users.length ? User.find({ _id: { $in: wanted.users } }).select("firstName lastName").lean() : [],
      wanted.tickets.length ? Ticket.find({ _id: { $in: wanted.tickets } }).select("num").lean() : [],
    ]);
    const view = {
      names: new Map(users.map((user) => [String(user._id), fullName(user)])),
      ticketNums: new Map(tickets.map((ticket) => [String(ticket._id), ticket.num])),
      // Право берётся только из сессии
      canSeeDiff: Boolean(req.auth?.can?.({ mikrotik: ["manageConfigs"] })),
    };

    res.status(200).json({
      events: page.map((event) => toView(event, view)),
      total,
      nextBefore: rows.length > limit ? encodeCursor(page.at(-1)) : null,
    });
  } catch (error) {
    next(new AppError("Failed to load mikrotik events", 500, true, error));
  }
};
