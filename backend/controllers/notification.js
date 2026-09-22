const InAppNotification = require("@/models/inAppNotification");
const { AppError } = require("@/middleware/errorHandling");
const { parseCategories } = require("@/services/notificationCategories");
const {
  markInboxRead,
  markSeen,
  markTicketSeen,
  unreadByCategory,
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

/**
 * GET /notifications?before=&limit=&category= — новые сверху, курсор по
 * createdAt. `category` — фасет панели (через запятую): лента постранична,
 * поэтому фильтрует сервер, иначе «Показать ещё» привозило бы чужой вид.
 */
exports.list = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const before = req.query.before ? new Date(req.query.before) : null;
    const categories = parseCategories(req.query.category);
    const filter = {
      userId,
      ...(before ? { createdAt: { $lt: before } } : {}),
      ...(categories ? { category: { $in: categories } } : {}),
    };
    // Берём на одну больше, чтобы знать, есть ли следующая страница
    const rows = await InAppNotification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;

    const [count, byCategory] = await Promise.all([
      unreadCount(userId),
      unreadByCategory(userId),
    ]);
    res.status(200).json({
      items,
      unreadCount: count,
      unreadByCategory: byCategory,
      nextBefore: hasMore ? items[items.length - 1].createdAt : null,
    });
  } catch (error) {
    next(new AppError("Failed to fetch notifications", 500, true, error));
  }
};

/**
 * Счётчик, непрочитанное по категориям (числа у чипов панели) и время
 * последнего уведомления — всё, что нужно колокольчику. Его приносит пульс
 * (controllers/pulse.js), когда входящие человека изменились.
 */
const summaryFor = async (userId) => {
  const [count, byCategory, latest] = await Promise.all([
    unreadCount(userId),
    unreadByCategory(userId),
    InAppNotification.findOne({ userId })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean(),
  ]);
  return {
    unreadCount: count,
    unreadByCategory: byCategory,
    latestAt: latest?.createdAt ?? null,
  };
};
exports.summaryFor = summaryFor;

/** GET /notifications/summary */
exports.summary = async (req, res, next) => {
  try {
    res.status(200).json(await summaryFor(req.auth.userId));
  } catch (error) {
    next(new AppError("Failed to fetch notifications summary", 500, true, error));
  }
};

/**
 * POST /notifications/read { ids? | all? (+ categories?) | ticketId? } —
 * `categories` с `all`: «прочитать все» при включённом фасете читает только
 * показанный вид.
 */
exports.read = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const { ids, all, ticketId, categories } = req.body;
    const updated = await markInboxRead(userId, {
      ids,
      all: all === true || all === "true",
      ticketId,
      categories: Array.isArray(categories) && categories.length
        ? categories
        : undefined,
    });
    const [count, byCategory] = await Promise.all([
      unreadCount(userId),
      unreadByCategory(userId),
    ]);
    res
      .status(200)
      .json({ updated, unreadCount: count, unreadByCategory: byCategory });
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
