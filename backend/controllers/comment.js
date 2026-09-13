const storage = require("../services/storage");

const Comment = require("../models/comment");
const TicketLog = require("../models/ticketLog");
const { Ticket } = require("../models/ticket");
const Preferences = require("../models/preferences");

const { AppError } = require("../middleware/errorHandling");
const {
  canAccessTicket,
  assertTicketsAccessible,
} = require("../services/ticketAccess");
const { markSeen } = require("../services/ticketSeen");
const logger = require("../utils/logger");

exports.getAll = async (req, res, next) => {
  try {
    // Заявку уже подняла и проверила `requireTicketAccess`
    const ticket = req.ticket;

    const comments = await Comment.find({
      ticketId: ticket?._id,
    }).sort({ _id: 1 });

    res.status(200).json({
      total: comments.length,
      comments: comments,
    });
  } catch (error) {
    next(new AppError("Failed to fetch all comments", 500, true, error));
  }
};

const logFailure =
  (message, context = {}) =>
  (error) =>
    logger.log("error", message, {
      ...context,
      error: error.message,
      stack: error.stack,
    });

exports.add = async (req, res, next) => {
  // Откат в catch — только пока комментарий не стал частью заявки. После этого
  // удалять его файлы нельзя: сохранённый комментарий ссылался бы на удалённые
  // объекты, а человек получил бы отказ на то, что уже произошло.
  let comment = null;
  let attached = false;

  try {
    const authData = req.auth?.legacy ?? null;
    const prefs = await Preferences.findOne({});

    const { ticketId, content } = req.body;

    // Проверка стоит здесь, а не мидлварью на маршруте: `ticketId` приезжает в
    // multipart-теле, то есть до multer его не прочитать, а после — уже загружены
    // файлы. Отсюда их удаляет общий catch этого же обработчика.
    const [ticket] = await assertTicketsAccessible(req.auth, [ticketId]);

    const attachments = req.files
      ? req.files.map((file) => {
          return {
            mimetype: file.mimetype,
            name: file.key,
          };
        })
      : [];

    comment = new Comment({
      content: content,
      ticketId: ticketId,
      attachments: attachments,
      notifications: {
        lastAction: "new comment",
        // Всегда: канал «в приложении» есть даже при выключенных почте и
        // Telegram, свои гейты у каналов свои (middleware/notifications)
        pending: true,
      },
      createdBy: authData.userId,
      updatedBy: authData.userId,
    });

    await comment.save();

    // Комментарий без `_id` в `ticket.comments` интерфейс не покажет, а крон
    // уведомлений всё равно разошлёт (он ищет по `notifications.pending`) —
    // поэтому сбой этого шага откатывает и сам комментарий
    ticket.comments
      ? ticket.comments.push(comment._id)
      : (ticket.comments = [comment._id]);
    await ticket.save();
    attached = true;

    // Дальше — вторичное: комментарий уже виден в заявке, и отвечать 500 из-за
    // водяного знака или строки хроники нельзя — сбой только пишем в лог.
    // Свой комментарий — не «новое»: водяной знак автора двигаем следом за
    // движением заявки (хук комментария уже отработал, см. models/comment.js)
    await markSeen(authData.userId, [ticket._id]).catch(
      logFailure("Failed to mark ticket seen after comment", {
        ticketId: ticket._id,
      }),
    );

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticket: req.body.ticket,
      ticketId: ticket._id,
      user: {
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
      severity: "info",
      event: `добавлен комментарий`,
    });
    await logEntry
      .save()
      .catch(logFailure("Failed to log new comment", { ticketId: ticket._id }));

    res.status(201).json({
      message: "Comment added successfully!",
      comment: comment,
    });
  } catch (error) {
    if (!attached) {
      // `isNew` снимается только успешным save: комментарий есть в базе
      if (comment && !comment.isNew) {
        await Comment.deleteOne({ _id: comment._id }).catch(
          logFailure("Failed to roll back comment", {
            commentId: comment._id,
          }),
        );
      }
      for (const file of req.files ?? []) {
        storage
          .deleteObject(file.key)
          .catch(logFailure("Failed to delete file", { key: file.key }));
      }
    }
    // Отказ по доступу — это 403, а не сбой: заворачивать его в 500 значило бы
    // показать человеку страницу ошибки вместо внятного «недостаточно прав».
    next(
      error instanceof AppError
        ? error
        : new AppError(
            `Failed to add new comment for ticket ${req.body.ticketId}`,
            500,
            true,
            error,
          ),
    );
  }
};

// Массовое добавление комментария: один и тот же текст на несколько заявок.
// Без вложений (для bulk не поддерживаем). Повторяет логику add по каждой заявке.
exports.addMultiple = async (req, res, next) => {
  try {
    const authData = req.auth?.legacy ?? null;
    const prefs = await Preferences.findOne({});

    const { ids, content } = req.body;
    const commented = [];

    for (const id of ids) {
      const ticket = await Ticket.findById(id);
      // Несуществующую заявку пропускаем — список приходит из выделения и
      // мог устареть. А вот чужая заявка в теле означает не гонку, а подлог:
      // отказываем целиком, чтобы отказ было видно.
      if (!ticket) continue;
      if (!canAccessTicket(ticket, req.auth)) {
        return next(new AppError(`Заявка ${ticket.num} вам недоступна`, 403));
      }

      const comment = new Comment({
        content: content,
        ticketId: id,
        notifications: {
          lastAction: "new comment",
          pending: true,
        },
        createdBy: authData.userId,
        updatedBy: authData.userId,
      });

      await comment.save();

      ticket.comments
        ? ticket.comments.push(comment._id)
        : (ticket.comments = [comment._id]);
      await ticket.save();
      commented.push(ticket._id);

      const logEntry = new TicketLog({
        ticketId: ticket._id,
        user: {
          firstName: authData.firstName,
          lastName: authData.lastName,
        },
        severity: "info",
        event: `добавлен комментарий`,
      });
      await logEntry.save();
    }

    // Из списка заявки не открывают — водяной знак автора ставит сервер
    await markSeen(authData.userId, commented);

    res.status(201).json({
      message: "Comments added successfully!",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to add comment to multiple tickets`,
        500,
        true,
        error,
      ),
    );
  }
};

// `update` и `delete` удалены: ни один маршрут их не подключал, а проверка
// внутри сравнивала id пользователя со ссылкой на заявку
// (`authData.userId === comment.ticket`) — то есть была ложна всегда. Понадобится
// правка комментария — писать заново, от этого образца брать нечего.
