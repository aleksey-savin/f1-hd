const { tgSendMessage } = require("../middleware/tgBotApi");
const Notification = require("../models/notification");
const Preferences = require("../models/preferences");
const TicketLog = require("../models/ticketLog");
const { Ticket } = require("../models/ticket");

const logger = require("../utils/logger");

exports.checkTgNotifications = async () => {
  try {
    const notifications = await Notification.find({
      instrument: "telegram",
      $and: [{ sent: false }, { failed: false }],
    });

    if (notifications.length === 0) {
      return;
    }

    const prefs = await Preferences.findOne({});

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
          prefs.notify.global.attempts > notification.attemptsCounter &&
          (new Date(
            notification.updatedAt.getTime() +
              prefs.notify.global.attemptsInterval * 60000,
          ) < new Date() ||
            notification.attemptsCounter === 0);

        if (okToSend) {
          const message = await tgSendMessage(
            notification.to.chatId,
            notification.text,
            notification.replyMarkup,
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
          prefs.notify.global.attempts === notification.attemptsCounter
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
