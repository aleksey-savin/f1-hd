const crypto = require("crypto");

const Notification = require("@/models/notification");
const Preferences = require("@/models/preferences");
const TicketLog = require("@/models/ticketLog");
const { Ticket } = require("@/models/ticket");
const User = require("@/models/user");

const logger = require("@/utils/logger");
const { NOTIFY_MAX_ATTEMPTS, NOTIFY_RETRY_INTERVAL_MINUTES } = require("@/utils/retryPolicy");
const {
  REPLY_MARKER,
  ticketNumFromSubject,
} = require("@/services/emailReplyStripper");
// Объектом модуля, а не деструктуризацией: тест подменяет sendMail
const mailSend = require("@/services/mail/send");
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
 *
 * Гарантия доставки — «не меньше одного раза» (at-least-once), а не «ровно один
 * раз»: письмо уходит в SMTP, и только потом в базу пишется отметка об
 * исходе. Процесс, убитый между ними, и отметка, которую так и не удалось
 * записать, оставляют письмо в аренде, а когда она истечёт, оно уйдёт ещё раз.
 * Дубль возможен; письмо, об исходе которого очередь не знает, не забывается.
 */

/**
 * Маркер границы ответа. Берётся из разборщика входящей почты, а не пишется
 * рядом: он ДОЛЖЕН совпадать байт в байт, иначе цитата в ответе перестанет
 * отрезаться. Раньше это была константа-близнец в двух репозиториях с
 * комментарием «менять синхронно» — то есть договорённость вместо проверки.
 */
const REPLY_MARKER_HTML = `<p style="color:#999999;font-size:12px;margin:0 0 12px 0">${REPLY_MARKER}</p>`;

/**
 * Тело письма, собранное из текста уведомления.
 *
 * Служебная строка «пишите ответ выше» ставится ТОЛЬКО письмам, ответ на
 * которые вернётся в систему: тема адресует заявку, и входящий разборщик
 * (middleware/emailHandling) положит ответ комментарием. Раньше строку получало
 * каждое письмо без своей вёрстки — коды подтверждения, уведомления об
 * отсутствиях, письма Mikrotik, — то есть строка обещала переписку там, где
 * ответ уходит в никуда.
 *
 * Признак — номер заявки в теме, а не наличие `ticketId`: разбирает тему тот же
 * код, что маршрутизирует входящий ответ, поэтому обещание и его исполнение не
 * могут разъехаться.
 */
const textBody = (notification) =>
  ticketNumFromSubject(notification.title) === null
    ? notification.text
    : REPLY_MARKER_HTML + notification.text;

/**
 * Аренда письма. Очередь — обычная коллекция, и «взять на отправку» обязано
 * быть атомарным: иначе два прогона — наложившиеся или перезапущенный посреди
 * пачки — отправят одно письмо дважды. Приём тот же, что у telegram-очереди
 * (controllers/bot.js, outboxPull/outboxAck): письмо берётся
 * `findOneAndUpdate` с leaseUntil/leaseId, исход пишется только по
 * `{_id, leaseId}`. Истёкшая аренда снова свободна — так очередь переживает
 * падение прогона.
 *
 * Срок — пять минут: с запасом больше даже медленной, но реалистичной
 * отправки. Потолка у SMTP-обмена при этом нет. Таймауты транспорта
 * (services/mail/transport.js: 15 + 10 + 30 с) — не бюджет на весь обмен, а
 * отдельные таймеры. socketTimeout в nodemailer 10 — таймер простоя сокета: его
 * сбрасывает каждый байт, и он действует на каждую команду отдельно (EHLO,
 * STARTTLS, AUTH, MAIL, RCPT, DATA, итоговый ответ). connectionTimeout взводится
 * заново на каждый адрес из DNS, а dnsTimeout (в buildSmtpOptions — 2 с) в эту
 * сумму не входит вовсе: это таймаут первой попытки запроса к резолверу, и
 * молчащий резолвер отпускает запрос лишь через ~14 таймаутов (около 27 с, а с
 * запросом AAAA — около минуты). Сервер, который отвечает на каждую команду чуть
 * раньше таймаута, тянет отправку далеко за 55 с, и ни один таймер не
 * срабатывает: в замере вышло около 168 с.
 *
 * Отправка, пережившая аренду, может уйти дважды, но только если очередь
 * разбирает второй процесс. Сейчас его нет: backend один, а реестр
 * крон-заданий (services/jobs/guardedCron.js) не начинает прогон, пока не
 * кончился предыдущий. Появится второй процесс (масштабирование, blue-green) —
 * срок придётся пересматривать, а аренду продлевать на время отправки.
 *
 * Цена запаса: письмо прогона, убитого посреди отправки, вернётся в очередь не
 * через две минуты, а через пять, а если оно уже ушло, уйдёт ещё раз — это та
 * же гарантия at-least-once, о которой сказано в начале файла.
 */
const LEASE_MS = 5 * 60 * 1000;

/**
 * Паузы между попытками записать отметку об исходе: попыток три — сразу, через
 * 200 мс и ещё через секунду. Короткий сбой связи с базой (обрыв, выборы
 * primary) так переживается; дольше ждать не стоит — это держало бы всю пачку,
 * а неотмеченное письмо и так вернётся в очередь по истечении аренды.
 */
const ACK_PAUSES_MS = [200, 1000];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Сколько писем разбирает один прогон — как прежний limit(100). */
const BATCH_LIMIT = 100;

/**
 * Что можно брать: не отправлено, попытки не исчерпаны, пауза после прошлой
 * попытки выдержана (первая — сразу, повтор — не раньше
 * NOTIFY_RETRY_INTERVAL_MINUTES от updatedAt, как в прежнем okToSend), аренды
 * нет или она истекла. Отсутствие поля аренды значит «свободно».
 */
const claimableFilter = (now) => ({
  instrument: "email",
  sent: false,
  failed: false,
  attemptsCounter: { $lt: NOTIFY_MAX_ATTEMPTS },
  $and: [
    { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
    {
      $or: [
        { attemptsCounter: 0 },
        {
          updatedAt: {
            $lt: new Date(
              now.getTime() - NOTIFY_RETRY_INTERVAL_MINUTES * 60000,
            ),
          },
        },
      ],
    },
  ],
});

/**
 * Хранилище очереди. Модель и часы — параметры: тест проверяет запросы без
 * базы, а разбор пачки получает очередь в памяти.
 */
const createMailQueue = ({ model = Notification, now = () => new Date() } = {}) => ({
  /** Взять следующее письмо в аренду; null — брать нечего. */
  claim: (leaseId) => {
    const at = now();
    return model.findOneAndUpdate(
      claimableFilter(at),
      { $set: { leaseUntil: new Date(at.getTime() + LEASE_MS), leaseId } },
      // timestamps: false — updatedAt остаётся временем прошлой попытки: от
      // него считается пауза перед повтором
      { sort: { createdAt: 1 }, returnDocument: "after", timestamps: false },
    );
  },

  /**
   * Записать исход и снять аренду — только если она всё ещё наша.
   *
   * @returns {Promise<boolean>} false — аренда истекла и письмо уже переиграно
   */
  ack: async (notification, leaseId, fields) => {
    const result = await model.updateOne(
      { _id: notification._id, leaseId },
      { $set: { ...fields, leaseUntil: null, leaseId: null } },
    );
    return result.matchedCount === 1;
  },

  /** Удалить письмо, которое слать больше некому или не о чем, — по аренде. */
  drop: (notification, leaseId) =>
    model.deleteOne({ _id: notification._id, leaseId }),
});

const mailQueue = createMailQueue();

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

/**
 * Одна попытка отправки: письмо уходит, исход возвращается полями для записи.
 * Документ не сохраняется — это дело вызывающего: очередь пишет исход по
 * аренде, sendNow вставляет документ уже с исходом.
 */
const attempt = async (notification, channel) => {
  const message = await mailSend.sendMail(
    channel,
    notification.to.email,
    notification.title,
    "",
    /**
     * Письмо со своей вёрсткой (html) — документ с кнопкой, на него не
     * отвечают. ВНИМАНИЕ: если html появится у уведомлений по заявкам, маркер
     * придётся возвращать и сюда.
     */
    notification.html || textBody(notification),
  );

  const attemptsCounter = notification.attemptsCounter + 1;
  const sent = Boolean(message?.success);
  // Отказ, который повтор не исправит (пароль SMTP не читается), не ждёт
  // остальных попыток: письмо сразу failed, а не три раза с паузой в пятнадцать
  // минут получает тот же ответ
  const exhausted =
    !sent &&
    (message?.retryable === false || attemptsCounter >= NOTIFY_MAX_ATTEMPTS);
  return {
    message,
    exhausted,
    fields: { attemptsCounter, sent, ...(exhausted ? { failed: true } : {}) },
  };
};

/**
 * Состояние канала и хроника заявки — ПОСЛЕ записи исхода и без права его
 * сорвать: письмо, которое ушло, не должно остаться «неотправленным» из-за
 * сбоя строки состояния.
 */
const recordOutcome = async (notification, { message, exhausted }) => {
  // Состояние канала для строки в настройках: реальная отправка — самый честный
  // источник, куда точнее кнопки проверки.
  try {
    if (message?.success) {
      await recordOk(SMTP, { message: true });
    } else if (message?.failure) {
      await recordError(SMTP, message.failure);
    }
  } catch (error) {
    logger.log("warn", "Не удалось записать состояние почтового канала", {
      module: "mailOutbox",
      error: error.message,
    });
  }

  const label = recipientLabel(notification);
  if (message?.success) {
    await addTicketLog(
      notification.ticketId,
      `отправлено email-уведомление пользователю ${label}`,
      "info",
    );
    return;
  }
  await addTicketLog(
    notification.ticketId,
    exhausted
      ? `email-уведомление пользователю ${label} не было отправлено`
      : `при отправке email-уведомления пользователю ${label} произошла ошибка`,
    "danger",
  );
};

/**
 * Записать исход попытки по аренде и пережить короткий сбой базы.
 *
 * Отметку нельзя терять молча: без неё письмо вернётся в очередь по истечении
 * аренды и, если оно уже ушло, уйдёт ещё раз (at-least-once, см. начало
 * файла). Запись безопасна для повтора: условие `{_id, leaseId}` срабатывает,
 * только пока аренда наша.
 * Повторяется сбой (исключение) — по ACK_PAUSES_MS. Ответ «аренда уже чужая»
 * (false) — это ответ базы, а не сбой: повторять его незачем. (Если запись
 * дошла, а ответ потерялся, повтор вернёт false: строка про истёкшую аренду
 * тогда неточна, но данные верны — отметка уже стоит.)
 *
 * Не вышло и после повторов — своя строка журнала. Это НЕ «не удалось отправить
 * письмо»: после удачной отправки она так и говорит, что письмо ушло и что
 * возможен дубль.
 *
 * @returns {Promise<boolean>} false — отметка так и не записана. Состояние
 *   канала и хронику тогда не пишем: база только что не ответила, а письмо
 *   вернётся в очередь по истечении аренды, и исход ляжет при той попытке.
 */
const ackWithRetry = async ({ queue, notification, leaseId, outcome, sleep }) => {
  const meta = { module: "mailOutbox", notificationId: String(notification._id) };

  let lastError;
  for (let tried = 0; tried <= ACK_PAUSES_MS.length; tried += 1) {
    if (tried > 0) await sleep(ACK_PAUSES_MS[tried - 1]);

    let ours;
    try {
      ours = await queue.ack(notification, leaseId, outcome.fields);
    } catch (error) {
      lastError = error;
      continue;
    }
    if (!ours) {
      logger.log(
        "warn",
        "Аренда письма истекла до подтверждения — исход не записан",
        meta,
      );
    }
    return true;
  }

  logger.log(
    "warn",
    outcome.message?.success
      ? "Письмо отправлено, но отметка не записалась — возможна повторная отправка"
      : "Отметка о неудачной отправке не записалась — попытка не засчитана",
    { ...meta, error: lastError.message },
  );
  return false;
};

/**
 * Письмо, которого человек ждёт ПРЯМО СЕЙЧАС: код для входа или смены пароля,
 * ссылка на смену пароля. Отправляется тут же, а исход отдаётся вызывающему —
 * экран обязан сказать «не ушло», а не «отправлено», и узнать это он может
 * только так.
 *
 * Принимает НЕСОХРАНЁННЫЙ документ и сохраняет его сам, уже с исходом, одной
 * записью. Сохранять заранее нельзя: между записью и концом
 * SMTP-обмена проходят секунды, крон очереди ходит раз в двадцать, и
 * документ «не отправлено, попыток ноль» он подхватывал — письмо уходило
 * дважды.
 *
 * Не ушло — письмо помечается `failed`, повторов крона не будет: через
 * пятнадцать минут код уже недействителен, а человек давно нажал «ещё раз».
 *
 * @returns {Promise<{success: boolean, failure?: {state: string, hint: string}}>}
 */
exports.sendNow = async (notification) => {
  const prefs = await Preferences.findOne({});
  if (!prefs?.notify?.byEmail?.isActive) {
    notification.failed = true;
    await notification.save();
    return {
      success: false,
      failure: { state: "Почта выключена", hint: "" },
    };
  }

  const outcome = await attempt(notification, prefs.notify.byEmail);
  notification.set(outcome.fields);
  if (!outcome.message?.success) {
    notification.failed = true;
  }
  await notification.save();
  await recordOutcome(notification, outcome);
  return outcome.message || { success: false };
};

/**
 * Разбор очереди: письма берутся в аренду по одному, пока есть что брать (не
 * больше BATCH_LIMIT за прогон).
 *
 * Очередь, отправка и пауза — параметры ради теста; крон зовёт без аргументов.
 *
 * @param {{
 *   queue?: ReturnType<typeof createMailQueue>,
 *   send?: typeof attempt,
 *   sleep?: (ms: number) => Promise<void>
 * }} [deps]
 */
exports.sendPendingEmails = async ({
  queue = mailQueue,
  send = attempt,
  sleep = defaultSleep,
} = {}) => {
  const prefs = await Preferences.findOne({});
  if (!prefs?.notify?.byEmail?.isActive) return;

  // Свой ключ аренды у каждого прогона: подтверждение чужого не примется
  const leaseId = crypto.randomUUID();

  for (let taken = 0; taken < BATCH_LIMIT; taken += 1) {
    const notification = await queue.claim(leaseId);
    if (!notification) break;

    /**
     * Каждое письмо разбирается САМО ПО СЕБЕ.
     *
     * В прежней версии здесь стоял `return` вместо `continue`: одна заявка,
     * удалённая после постановки в очередь, обрывала разбор всей пачки, и
     * остальные письма ждали следующего тика. При череде таких документов
     * очередь двигалась по одному письму за двадцать секунд.
     *
     * Сбой посреди письма оставляет его в аренде: оно вернётся в очередь,
     * когда аренда истечёт, а не следующим тиком — прогон, упавший между
     * SMTP и подтверждением, не отправит его второй раз сразу же, а только
     * после аренды (at-least-once, см. начало файла).
     */
    try {
      // Заявка удалена — уведомление о ней бессмысленно.
      if (notification.ticketId) {
        const ticket = await Ticket.findById(notification.ticketId).select("_id");
        if (!ticket) {
          await queue.drop(notification, leaseId);
          continue;
        }
      }

      if (!notification.to?.email) {
        await queue.ack(notification, leaseId, { failed: true });
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
        await queue.drop(notification, leaseId);
        continue;
      }

      /**
       * Три шага, порядок важен.
       *  1. Отправка. Исход — ЗНАЧЕНИЕ (`outcome`: ушло или нет и что
       *     записать); бросок отсюда оставляет письмо в аренде. Нечитаемый
       *     пароль SMTP тоже исход, а не бросок: sendMail отвечает failure без
       *     права на повтор, и письмо сразу получает failed — иначе оно висело
       *     бы в аренде вечно, а строка состояния молчала бы.
       *  2. Отметка об исходе по аренде. Между отправкой и ею — окно, где
       *     возможен дубль, поэтому ничего лишнего там нет. Свой сбой отметка
       *     называет сама (ackWithRetry) и сюда не бросает.
       *  3. Состояние канала и хроника заявки — после отметки; их сбой её не
       *     отменяет.
       */
      const outcome = await send(notification, prefs.notify.byEmail);
      if (!(await ackWithRetry({ queue, notification, leaseId, outcome, sleep }))) {
        continue;
      }
      await recordOutcome(notification, outcome);
    } catch (error) {
      logger.log("error", "Не удалось отправить письмо из очереди", {
        module: "mailOutbox",
        notificationId: String(notification._id),
        error: error.message,
      });
    }
  }
};

exports.createMailQueue = createMailQueue;
exports.LEASE_MS = LEASE_MS;
