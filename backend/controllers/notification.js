const InAppNotification = require("@/models/inAppNotification");
const { AppError } = require("@/middleware/errorHandling");
const {
  markInboxRead,
  markSeen,
  markTicketSeen,
  unreadCount,
} = require("@/services/ticketSeen");

/**
 * Колокольчик: уведомления «в приложении» текущего человека.
 *
 * Прав не нужно — каждый читает и правит только своё: все запросы отсечены
 * `req.auth.userId`. Заявочные ручки «просмотрено» живут в маршрутах заявок и
 * проходят их проверку доступа (`req.ticket` / `req.tickets`).
 */

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** GET /notifications?before=&limit= — новые сверху, курсор по createdAt */
exports.list = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const before = req.query.before ? new Date(req.query.before) : null;
    const filter = {
      userId,
      ...(before ? { createdAt: { $lt: before } } : {}),
    };
    // Берём на одну больше, чтобы знать, есть ли следующая страница
    const rows = await InAppNotification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;

    res.status(200).json({
      items,
      unreadCount: await unreadCount(userId),
      nextBefore: hasMore ? items[items.length - 1].createdAt : null,
    });
  } catch (error) {
    next(new AppError("Failed to fetch notifications", 500, true, error));
  }
};

/** GET /notifications/summary — то, что опрашивает колокольчик раз в 15 секунд */
exports.summary = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const [count, latest] = await Promise.all([
      unreadCount(userId),
      InAppNotification.findOne({ userId })
        .sort({ createdAt: -1 })
        .select("createdAt")
        .lean(),
    ]);
    res.status(200).json({
      unreadCount: count,
      latestAt: latest?.createdAt ?? null,
    });
  } catch (error) {
    next(new AppError("Failed to fetch notifications summary", 500, true, error));
  }
};

/** POST /notifications/read { ids? | all? | ticketId? } */
exports.read = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const { ids, all, ticketId } = req.body;
    const updated = await markInboxRead(userId, {
      ids,
      all: all === true || all === "true",
      ticketId,
    });
    res.status(200).json({ updated, unreadCount: await unreadCount(userId) });
  } catch (error) {
    next(new AppError("Failed to mark notifications read", 500, true, error));
  }
};

/**
 * POST /tickets/:ticketNum/seen — заявку открыли: водяной знак и её
 * уведомления прочитаны. Возвращает прежний знак — по нему хроника проводит
 * черту «Новые».
 */
exports.markTicketSeen = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    // Заявку уже подняла и проверила `requireTicketAccess`
    const ticket = req.ticket;
    const { seenAt, previousSeenAt } = await markTicketSeen(userId, ticket._id);
    await markInboxRead(userId, { ticketId: ticket._id });
    res.status(200).json({
      seenAt,
      previousSeenAt,
      unreadCount: await unreadCount(userId),
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to mark ticket ${req.params.ticketNum} seen`,
        500,
        true,
        error,
      ),
    );
  }
};

/** POST /tickets/seen { ids } — «Отметить прочитанными» из очереди «Непрочитанные» */
exports.markTicketsSeen = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    // Заявки уже подняла и проверила `requireTicketsAccess`
    const ids = (req.tickets || []).map((ticket) => ticket._id);
    const seenAt = new Date();
    const count = await markSeen(userId, ids, seenAt);
    await markInboxRead(userId, { ticketIds: ids });
    res.status(200).json({
      seenAt,
      count,
      unreadCount: await unreadCount(userId),
    });
  } catch (error) {
    next(new AppError("Failed to mark tickets seen", 500, true, error));
  }
};
