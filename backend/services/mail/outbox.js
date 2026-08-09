const Notification = require("@/models/notification");
const Preferences = require("@/models/preferences");
const TicketLog = require("@/models/ticketLog");
const { Ticket } = require("@/models/ticket");
const User = require("@/models/user");

const logger = require("@/utils/logger");
const { NOTIFY_MAX_ATTEMPTS, NOTIFY_RETRY_INTERVAL_MINUTES } = require("@/utils/retryPolicy");
const { REPLY_MARKER } = require("@/services/emailReplyStripper");
const { sendMail } = require("@/services/mail/send");
const { SMTP, recordOk, recordError } = require("@/services/mail/health");

/**
 * Разбор очереди почтовых уведомлений. Переехало из telegram-bot.
 *
 * Очередь и раньше лежала здесь, в коллекции `notifications`; разбирал её
 * телеграм-бот, потому что там крутился крон. Смысла в этом не было никакого, а
 * цена была: удалённая машина с почтовыми секретами и полным доступом к базе.
 *
 * ВАЖНО: этот крон и почтовый отправщик прежнего бота не должны работать
 * одновременно — каждое письмо ушло бы дважды. Поэтому переезд едет тем же
 * релизом, что и замена бота на tg-service.
 */

/**
 * Маркер границы ответа. Берётся из разборщика входящей почты, а не пишется
 * рядом: он ДОЛЖЕН совпадать байт в байт, иначе цитата в ответе перестанет
 * отрезаться. Раньше это была константа-близнец в двух репозиториях с
 * комментарием «менять синхронно» — то есть договорённость вместо проверки.
 */
const REPLY_MARKER_HTML = `<p style="color:#999999;font-size:12px;margin:0 0 12px 0">${REPLY_MARKER}</p>`;

/** Пора ли пробовать: попытки не исчерпаны и пауза между ними выдержана. */
const okToSend = (notification) =>
  NOTIFY_MAX_ATTEMPTS > notification.attemptsCounter &&
  (notification.attemptsCounter === 0 ||
    new Date(
      notification.updatedAt.getTime() + NOTIFY_RETRY_INTERVAL_MINUTES * 60000,
    ) < new Date());

const addTicketLog = async (ticketId, event, severity) => {
  if (!process.env.ADD_TICKET_LOG || !ticketId) return;
  try {
    await new TicketLog({ ticketId, event, severity }).save();
  } catch (error) {
    logger.log("warn", "Не удалось записать событие письма в хронику", {
      module: "mailOutbox",
      error: error.message,
    });
  }
};

const recipientLabel = (notification) => {
  const to = notification.to || {};
  return to.responsible || to.manager || to.applicant || to.email || "получателю";
};

const deliver = async (notification, channel) => {
  const label = recipientLabel(notification);

  const message = await sendMail(
    channel,
    notification.to.email,
    notification.title,
    "",
    /**
     * Письмо со своей вёрсткой (html) — документ с кнопкой, на него не
     * отвечают, и служебная строка «пишите ответ выше» в нём только мешает.
     * Маркер остаётся у переписки по заявкам: по нему отрезается цитата во
     * входящем ответе. ВНИМАНИЕ: если html появится у уведомлений по заявкам,
     * маркер придётся возвращать.
     */
    notification.html || REPLY_MARKER_HTML + notification.text,
  );

  // Состояние канала для строки в настройках: реальная отправка — самый честный
  // источник, куда точнее кнопки проверки.
  if (message?.success) {
    await recordOk(SMTP, { message: true });
  } else if (message?.failure) {
    await recordError(SMTP, message.failure);
  }

  notification.attemptsCounter += 1;

  if (message?.success) {
    notification.sent = true;
    await notification.save();
    await addTicketLog(
      notification.ticketId,
      `отправлено email-уведомление пользователю ${label}`,
      "info",
    );
    return;
  }

  const exhausted = notification.attemptsCounter >= NOTIFY_MAX_ATTEMPTS;
  if (exhausted) {
    notification.failed = true;
  }
  await notification.save();

  await addTicketLog(
    notification.ticketId,
    exhausted
      ? `email-уведомление пользователю ${label} не было отправлено`
      : `при отправке email-уведомления пользователю ${label} произошла ошибка`,
    "danger",
  );
};

exports.sendPendingEmails = async () => {
  const pending = await Notification.find({
    instrument: "email",
    sent: false,
    failed: false,
  }).limit(100);

  if (pending.length === 0) return;

  const prefs = await Preferences.findOne({});
  if (!prefs?.notify?.byEmail?.isActive) return;

  for (const notification of pending) {
    /**
     * Каждое письмо разбирается САМО ПО СЕБЕ.
     *
     * В прежней версии здесь стоял `return` вместо `continue`: одна заявка,
     * удалённая после постановки в очередь, обрывала разбор всей пачки, и
     * остальные письма ждали следующего тика. При череде таких документов
     * очередь двигалась по одному письму за двадцать секунд.
     */
    try {
      // Заявка удалена — уведомление о ней бессмысленно.
      if (notification.ticketId) {
        const ticket = await Ticket.findById(notification.ticketId).select("_id");
        if (!ticket) {
          await Notification.deleteOne({ _id: notification._id });
          continue;
        }
      }

      if (!notification.to?.email) {
        notification.failed = true;
        await notification.save();
        continue;
      }

      /**
       * Служебным учёткам не пишем. А вот ОТСУТСТВИЕ пользователя больше не
       * повод удалять письмо: прежний код удалял всё, чей адрес не нашёлся в
       * `users`, — то есть тихо выбрасывал переписку с внешними адресатами,
       * которые пишут в поддержку почтой и учётки не имеют.
       */
      const account = await User.findOne({ email: notification.to.email }).select(
        "isServiceAccount",
      );
      if (account?.isServiceAccount) {
        await Notification.deleteOne({ _id: notification._id });
        continue;
      }

      if (!okToSend(notification)) {
        continue;
      }

      await deliver(notification, prefs.notify.byEmail);
    } catch (error) {
      logger.log("error", "Не удалось отправить письмо из очереди", {
        module: "mailOutbox",
        notificationId: String(notification._id),
        error: error.message,
      });
    }
  }
};
