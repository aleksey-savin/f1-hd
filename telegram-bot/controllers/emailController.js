const { sendMail } = require("../middleware/nodemailer");
const Notification = require("../models/notification");
const Preferences = require("../models/preferences");
const TicketLog = require("../models/ticketLog");
const { Ticket } = require("../models/ticket");
const User = require("../models/user");

const logger = require("../utils/logger");

exports.checkEmailNotifications = async () => {
  try {
    const notifications = await Notification.find({
      instrument: "email",
      $and: [
        { $or: [{ sent: false }, { sent: { $exists: false } }] },
        { failed: false },
      ],
    });

    if (notifications.length === 0) {
      return;
    }

    const prefs = await Preferences.findOne({});

    // отправка уведомлений в глобальный канал
    if (prefs.notify?.byEmail.isActive) {
      for (let notification of notifications) {
        try {
          // проверяем, что заявка существует и не удалена
          const ticket = await Ticket.findById(notification.ticketId);
          if (!ticket && notification.ticketId) {
            await Notification.deleteOne({ _id: notification._id });
            logger.log("warning", `No such ticket, deleting notification`);
            return;
          }

          const okToSend =
            prefs.notify.global.attempts > notification.attemptsCounter &&
            (new Date(
              notification.updatedAt.getTime() +
                prefs.notify.global.attemptsInterval * 60000,
            ) < new Date() ||
              notification.attemptsCounter === 0) &&
            !notification.failed;

          const user = notification.to.responsible
            ? notification.to.responsible
            : notification.to.manager
              ? notification.to.manager
              : notification.to.applicant;

          const account = await User.findOne({
            email: notification.to?.email,
          });

          if (!account || account?.isServiceAccount) {
            await Notification.deleteOne({ _id: notification._id });
            logger.log("warning", `No such account, deleting notification`);
            return;
          }

          if (okToSend) {
            const message = await sendMail(
              prefs.notify?.byEmail,
              notification.to.email,
              notification.title,
              "",
              notification.text,
            );
            if (message?.success) {
              notification.sent = true;
              await notification.save();
              if (process.env.ADD_TICKET_LOG) {
                // добавляем запись в лог заявки
                const logEntry = new TicketLog({
                  ticketId: notification.ticketId,
                  event: `отправлено email-уведомление пользователю ${user}`,
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
                  event: `при отправке email-уведомления пользователю ${user} произошла ошибка`,
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
              event: `email-уведомление пользователю ${user} не было отправлено`,
              severity: "danger",
            });
            await logEntry.save();
          }
        } catch (error) {
          logger.log("error", `Failed to send email notification`, {
            error: error.message,
            stack: error.stack,
          });
        }
      }
    }
  } catch (error) {
    logger.log("error", `Failed to process email notifications`, {
      error: error.message,
      stack: error.stack,
    });
  }
};
