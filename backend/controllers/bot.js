const crypto = require("crypto");

const Notification = require("@/models/notification");
const Preferences = require("@/models/preferences");
const TicketLog = require("@/models/ticketLog");

const { AppError } = require("@/middleware/errorHandling");
const { NOTIFY_MAX_ATTEMPTS } = require("@/utils/retryPolicy");
const { WORK_STATUSES } = require("@/utils/workStatuses");
const logger = require("@/utils/logger");

/**
 * Ручки, которыми живёт telegram-сервис.
 *
 * Всё, за чем он раньше ходил в Mongo своим подключением и своими копиями
 * моделей, теперь спрашивается здесь. Смысл не в транспорте: пока у бота есть
 * учётные данные базы, у него есть и `authSessions`, и `authAccounts`, и
 * возможность подписать чужую cookie — то есть компрометация самого открытого
 * наружу компонента равна компрометации всего.
 */

/** Сколько уведомлений отдаём за один заход. */
const OUTBOX_BATCH = 25;

/**
 * Срок аренды. Должен с запасом покрывать отправку пачки: Telegram отвечает за
 * доли секунды, но при 429 отправщик ждёт `retry_after`. Слишком короткая
 * аренда означала бы повторную выдачу ещё не отправленного уведомления.
 */
const LEASE_MS = 2 * 60 * 1000;

/**
 * Кому предназначалось уведомление — человекочитаемо, для хроники заявки.
 * Раньше эта лесенка стояла в боте в двух экземплярах (успех и ошибка).
 *
 * Последняя ветка читала `to.company`, которого в схеме нет вовсе (есть
 * `companyChat`), то есть писала в хронику «компании undefined». Идентификатор
 * чата в ленте заявки не нужен — там имена, а не внутренние ключи.
 */
const recipientLabel = (notification) => {
  const to = notification.to || {};
  if (to.globalChat) return "в глобальный telegram-чат";
  if (to.applicant) return `пользователю ${to.applicant}`;
  if (to.responsible) return `пользователю ${to.responsible}`;
  if (to.manager) return `менеджеру ${to.manager}`;
  if (to.companyChat) return "в чат компании";
  return "получателю";
};

/**
 * Хроника заявки ведётся под тем же выключателем, что и раньше: запись про
 * каждое уведомление заметно удлиняет ленту, и включается она осознанно.
 */
const addTicketLog = async (notification, event, severity) => {
  if (!process.env.ADD_TICKET_LOG || !notification.ticketId) {
    return;
  }
  try {
    await new TicketLog({
      ticketId: notification.ticketId,
      event,
      severity,
    }).save();
  } catch (error) {
    // Хроника — не причина терять доставку.
    logger.log("warn", "Не удалось записать событие доставки в хронику", {
      module: "bot",
      notificationId: String(notification._id),
      error: error.message,
    });
  }
};

/**
 * Забрать пачку telegram-уведомлений на отправку.
 *
 * Аренда берётся ПОДОКУМЕНТНО через `findOneAndUpdate`: он атомарен, а
 * транзакций у нас нет — MongoDB стоит standalone. Забрать одно уведомление
 * дважды поэтому нельзя, даже если отправщиков окажется два.
 */
exports.outboxPull = async (req, res, next) => {
  try {
    const now = new Date();
    const leaseId = crypto.randomUUID();
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const limit = Math.min(
      Number(req.query.limit) || OUTBOX_BATCH,
      OUTBOX_BATCH,
    );

    const claimed = [];
    for (let taken = 0; taken < limit; taken += 1) {
      const notification = await Notification.findOneAndUpdate(
        {
          instrument: "telegram",
          sent: false,
          failed: false,
          attemptsCounter: { $lt: NOTIFY_MAX_ATTEMPTS },
          // Свободно = аренды не было вовсе (поля нет у всего, что создано до
          // этого релиза) либо она истекла.
          $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
        },
        { $set: { leaseUntil, leaseId } },
        { sort: { createdAt: 1 }, returnDocument: "after" },
      );

      if (!notification) break;
      claimed.push(notification);
    }

    res.status(200).json({
      leaseId,
      leaseExpiresAt: leaseUntil,
      notifications: claimed.map((notification) => ({
        id: notification._id,
        ticketId: notification.ticketId,
        chatId: notification.to?.chatId,
        messageThreadId: notification.to?.messageThreadId || null,
        globalChat: Boolean(notification.to?.globalChat),
        text: notification.text,
        // Блоки рич-сообщения; `text` рядом остаётся запасной дорогой.
        richMessage: notification.richMessage || null,
        replyMarkup: notification.replyMarkup || null,
        attempt: notification.attemptsCounter,
      })),
    });
  } catch (error) {
    next(new AppError("Не удалось выдать очередь", 500, true, error));
  }
};

/**
 * Подтвердить исход отправки.
 *
 * Отправщик сообщает ТОЛЬКО факт: получилось, не получилось и стоит ли
 * повторять. Счёт попыток, признание уведомления безнадёжным и запись в
 * хронику — дело владельца очереди. Раньше это жило в боте и разошлось: в
 * почтовой ветке `return` вместо `continue` обрывал разбор всей пачки.
 */
exports.outboxAck = async (req, res, next) => {
  try {
    const { leaseId, results } = req.body || {};

    if (!leaseId || !Array.isArray(results)) {
      return next(new AppError("Ожидаются leaseId и results", 400));
    }

    let applied = 0;
    let ignored = 0;

    for (const result of results) {
      /**
       * Каждый элемент разбирается сам по себе.
       *
       * Дословно этим и болел почтовый отправщик: `return` вместо `continue`
       * на пропущенном документе обрывал разбор всей пачки. Здесь опаснее
       * другое — негодный `id` даёт CastError, и без своего try он унёс бы
       * подтверждения всех остальных уведомлений, то есть отправленное ушло бы
       * повторно.
       */
      let notification;
      try {
        // Аренда сверяется вместе с id: подтверждение по истёкшей аренде
        // относится к попытке, которую очередь уже переиграла.
        notification = await Notification.findOne({
          _id: result?.id,
          leaseId,
        });
      } catch (error) {
        logger.log("warn", "Негодный идентификатор в подтверждении доставки", {
          module: "bot",
          id: String(result?.id),
          error: error.message,
        });
      }

      if (!notification) {
        ignored += 1;
        continue;
      }

      notification.attemptsCounter += 1;
      notification.leaseUntil = null;
      notification.leaseId = null;

      if (result.ok) {
        notification.sent = true;
        await notification.save();
        await addTicketLog(
          notification,
          `отправлено telegram-уведомление ${recipientLabel(notification)}`,
          "info",
        );
        applied += 1;
        continue;
      }

      /**
       * Безнадёжным уведомление становится по двум причинам: исчерпаны попытки
       * или отправщик прямо сказал, что повторять незачем (бот заблокирован,
       * чата больше нет). Второе — новое: раньше такие уведомления честно
       * перебирались до предела попыток.
       */
      const exhausted = notification.attemptsCounter >= NOTIFY_MAX_ATTEMPTS;
      if (exhausted || result.retryable === false) {
        notification.failed = true;
        await notification.save();
        await addTicketLog(
          notification,
          `telegram-уведомление ${recipientLabel(notification)} не было отправлено`,
          "danger",
        );
      } else {
        await notification.save();
      }
      applied += 1;
    }

    res.status(200).json({ applied, ignored });
  } catch (error) {
    next(new AppError("Не удалось принять подтверждение", 500, true, error));
  }
};

/**
 * Всё, что боту нужно знать о настройках. Спрашивается на старте и дальше по
 * кругу: прежний бот читал `Preferences` ОДИН раз при запуске и потом жил со
 * своей копией, поэтому смена группы, часового пояса или срока по умолчанию
 * доезжала до него только перезапуском.
 */
exports.config = async (req, res, next) => {
  try {
    const prefs = await Preferences.findOne({});

    res.status(200).json({
      telegram: {
        isActive: Boolean(prefs?.notify?.byTelegram?.isActive),
        sendToGroup: Boolean(prefs?.notify?.byTelegram?.sendToGroup),
        chatId: prefs?.notify?.byTelegram?.chatId || "",
        messageThreadId: prefs?.notify?.byTelegram?.messageThreadId || "",
        // Что сервер знает об имени бота — сервис сверяет со своим getMe и
        // при расхождении присылает актуальное (см. `identity`).
        botUsername: prefs?.notify?.byTelegram?.botUsername || "",
      },
      statusBoard: {
        isActive: Boolean(prefs?.statusBoard?.isActive),
        messageId: prefs?.statusBoard?.messageId ?? null,
      },
      timezone: prefs?.timezone || "Europe/Moscow",
      deadlineHours: prefs?.deadline ?? 10,
      /**
       * Каталог статусов приезжает с сервера, а не лежит третьей копией в
       * отправщике: сегодня `utils/workStatuses.js` совпадает байт в байт в
       * бэкенде, фронтенде и боте, и расхождение обнаружилось бы только
       * неправильной кнопкой у кого-то в чате.
       *
       * Отдаём ВЕСЬ каталог, а не выбираемое подмножество: табло одно на всю
       * группу, кнопки под ним общие, и «кому какой статус можно» решается на
       * нажатии (`canSetStatusManually` в `setWorkStatusFromTelegram`), где
       * известен человек. `manual` идёт рядом, чтобы отправщик не рисовал
       * кнопку заведомо отказного статуса.
       */
      workStatuses: WORK_STATUSES.map((status) => ({
        code: status.code,
        label: status.label,
        emoji: status.emoji,
        manual: status.manual,
      })),
    });
  } catch (error) {
    next(new AppError("Не удалось отдать настройки", 500, true, error));
  }
};

/**
 * Имя бота, как его знает сам Telegram. Сервис сообщает его после getMe и
 * дальше при каждом расхождении с тем, что отдаёт `config`, — так значение
 * переживает и смену токена, и перезапись настроек из формы. Фронту оно нужно
 * для ссылки привязки; раньше имя было переменной сборки фронта
 * (VITE_TG_BOT_NAME), то есть образ зависел от окружения.
 */
exports.identity = async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(username)) {
      return next(new AppError("Некорректное имя бота", 400, true));
    }

    await Preferences.updateOne(
      {},
      { $set: { "notify.byTelegram.botUsername": username } },
    );

    res.status(200).json({ username });
  } catch (error) {
    next(new AppError("Не удалось сохранить имя бота", 500, true, error));
  }
};

/**
 * Включить табло в этом чате — команда `/status_board` в группе команды.
 *
 * Гейт здесь, а не в боте, и это принципиально: прежний бот сам читал
 * `sender.isAdmin` из документа пользователя, то есть держал собственное
 * суждение о правах — мимо ролей, мимо `effectivePermissions`, и после переезда
 * на роли оно бы тихо разошлось с действительностью. Кто администратор, знает
 * бэкенд; сервис только пересказывает, кто нажал.
 */
exports.statusBoardSetup = async (req, res, next) => {
  try {
    const { chatId, messageThreadId } = req.body || {};

    if (!chatId || !String(chatId).startsWith("-")) {
      return next(
        new AppError("Табло включается в групповом чате, а не в личном", 400),
      );
    }

    await Preferences.updateOne(
      {},
      {
        $set: {
          "notify.byTelegram.chatId": String(chatId),
          "notify.byTelegram.messageThreadId": messageThreadId
            ? String(messageThreadId)
            : "",
          "statusBoard.isActive": true,
          // Табло пересоздаётся в новом месте: прежнее сообщение осталось в
          // другом чате или ветке и обновляться больше не должно.
          "statusBoard.messageId": null,
        },
      },
    );

    logger.log("info", "Табло статусов включено из Telegram", {
      module: "bot",
      chatId: String(chatId),
      by: req.auth.userId,
    });

    res.status(200).json({ message: "Табло включено" });
  } catch (error) {
    next(new AppError("Не удалось включить табло", 500, true, error));
  }
};

/**
 * Табло опубликовано или переехало.
 *
 * `messageId` остаётся в `Preferences`, а не уезжает в локальную базу
 * отправщика: это состояние ОБЩЕГО чата, и по нему администратор из веб-настроек
 * пересоздаёт табло, обнуляя поле. `chatId` меняется, когда группу повышают до
 * супергруппы, — Telegram присылает `migrate_to_chat_id`, и знать об этом обязан
 * бэкенд: именно он адресует групповые уведомления.
 */
exports.statusBoardMessage = async (req, res, next) => {
  try {
    const { messageId, migratedToChatId } = req.body || {};
    const update = {};

    if (migratedToChatId) {
      update["notify.byTelegram.chatId"] = String(migratedToChatId);
      update["statusBoard.messageId"] = null;
    } else if (messageId === null) {
      update["statusBoard.messageId"] = null;
    } else if (Number.isInteger(messageId)) {
      update["statusBoard.messageId"] = messageId;
    } else {
      return next(new AppError("Ожидается messageId или migratedToChatId", 400));
    }

    await Preferences.updateOne({}, { $set: update });
    res.status(200).json({ message: "Состояние табло обновлено" });
  } catch (error) {
    next(new AppError("Не удалось обновить состояние табло", 500, true, error));
  }
};
