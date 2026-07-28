const { tgSendMessage } = require("../middleware/tgBotApi");
const Notification = require("../models/notification");
const TicketLog = require("../models/ticketLog");
const { Ticket } = require("../models/ticket");

const logger = require("../utils/logger");
const { guardChat, guardText } = require("../utils/chatGuard");
const {
  NOTIFY_MAX_ATTEMPTS,
  NOTIFY_RETRY_INTERVAL_MINUTES,
} = require("../utils/retryPolicy");

exports.checkTgNotifications = async () => {
  try {
    const notifications = await Notification.find({
      instrument: "telegram",
      $and: [{ sent: false }, { failed: false }],
    });

    if (notifications.length === 0) {
      return;
    }

    // отправка уведомлений в глобальный канал
    for (let notification of notifications) {
      try {
        // проверяем, что заявка существует и не удалена
        const ticket = await Ticket.findById(notification.ticketId);
        if (!ticket && notification.ticketId) {
          await Notification.deleteOne({ _id: notification._id });
          logger.log("warning", `No such ticket, deleted notification`);
          continue;
        }
        // проверяем, что не превышено число попыток отправки и соблюдён интервал между ними
        const okToSend =
          NOTIFY_MAX_ATTEMPTS > notification.attemptsCounter &&
          (new Date(
            notification.updatedAt.getTime() +
              NOTIFY_RETRY_INTERVAL_MINUTES * 60000,
          ) < new Date() ||
            notification.attemptsCounter === 0);

        // Вне прода уведомление не может уйти клиенту: chatId в базе —
        // настоящий, а копия прод-снимка про это не знает (см. utils/chatGuard)
        const guarded = guardChat(notification.to.chatId);
        if (guarded.blocked) {
          notification.failed = true;
          await notification.save();
          continue;
        }

        if (okToSend) {
          const message = await tgSendMessage(
            guarded.chatId,
            guarded.redirected
              ? guardText(notification.text, guarded.intended)
              : notification.text,
            notification.replyMarkup,
            // Ветка форума из прод-чата в дев-чате не существует — сообщение
            // ушло бы в никуда с ошибкой
            guarded.redirected ? undefined : notification.to.messageThreadId,
          );
          if (message?.message_id) {
            notification.attemptsCounter += 1;
            notification.sent = true;
            await notification.save();

            if (process.env.ADD_TICKET_LOG) {
              // добавляем запись в лог заявки
              const logEntry = new TicketLog({
                ticketId: notification.ticketId,
                event: `отправлено telegram-уведомление ${
                  notification.to.globalChat
                    ? "в глобальный telegram-чат"
                    : notification.to.applicant
                      ? "пользователю " + notification.to.applicant
                      : notification.to.responsible
                        ? "пользователю " + notification.to.responsible
                        : notification.to.manager
                          ? "менеджеру " + notification.to.manager
                          : "компании " + notification.to.company
                }`,
                severity: "info",
              });
              await logEntry.save();
            }
          } else {
            notification.attemptsCounter += 1;
            await notification.save();
            if (process.env.ADD_TICKET_LOG) {
              // добавляем запись в лог заявки
              const logEntry = new TicketLog({
                ticketId: notification.ticketId,
                event: `ошибка при отправке telegram-уведомления ${
                  notification.to.globalChat
                    ? "в глобальный telegram-чат"
                    : notification.to.applicant
                      ? "пользователю " + notification.to.applicant
                      : notification.to.responsible
                        ? "пользователю " + notification.to.responsible
                        : notification.to.manager
                          ? "менеджеру " + notification.to.manager
                          : "компании " + notification.to.company
                }`,
                severity: "danger",
              });
              await logEntry.save();
            }
          }
        } else if (
          NOTIFY_MAX_ATTEMPTS === notification.attemptsCounter
        ) {
          notification.failed = true;
          await notification.save();
          const logEntry = new TicketLog({
            ticketId: notification.ticketId,
            event: `уведомление в глобальный telegram-канал, группу или чат не было отправлено`,
            severity: "danger",
          });
          await logEntry.save();
        }
      } catch (error) {
        logger.log("error", `Failed to send telegram notification`, {
          error: error.message,
          stack: error.stack,
        });
      }
    }
  } catch (error) {
    logger.log("error", `Failed to process telegram notifications`, {
      error: error.message,
      stack: error.stack,
    });
  }
};
