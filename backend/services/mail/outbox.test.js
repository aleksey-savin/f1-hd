// node --test services/mail/outbox.test.js
require("module-alias/register");
const crypto = require("node:crypto");

// Ключ шифрования теста — до первого обращения к secretBox (он кэширует ключ)
process.env.APP_ENC_KEY = crypto.randomBytes(32).toString("base64");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const net = require("node:net");
const tls = require("node:tls");
const mongoose = require("mongoose");

// Обращение к базе мимо подменённых методов падает сразу, а не висит десять
// секунд в ожидании подключения
mongoose.set("bufferCommands", false);

/**
 * Модель заявок подменена в require.cache до загрузки очереди: models/ticket.js на
 * верхнем уровне зовёт initCounter(), и без базы в выводе остаётся «Failed to
 * initialize counter» (тот же приём, что в controllers/company.access.test.js;
 * одного bufferCommands мало — он лишь заставляет initCounter упасть сразу, а не
 * через десять секунд). Очередь зовёт только Ticket.findById(...).select(...) —
 * тесты подменяют его в stubModels; неподменённый вызов падает, как прежде падал
 * запрос настоящей модели без базы.
 */
const ticketModel = require.resolve("@/models/ticket");
const ticketStub = new Module(ticketModel);
ticketStub.filename = ticketModel;
ticketStub.loaded = true;
ticketStub.exports = {
  Ticket: {
    findById: () => ({
      select: async () => {
        throw new Error("Ticket.findById не подменён тестом");
      },
    }),
  },
};
require.cache[ticketModel] = ticketStub;

const Notification = require("@/models/notification");
const Preferences = require("@/models/preferences");
const TicketLog = require("@/models/ticketLog");
const { Ticket } = require("@/models/ticket");
const User = require("@/models/user");
const logger = require("@/utils/logger");
const mailSend = require("@/services/mail/send");
const health = require("@/services/mail/health");
const { encryptSecret } = require("@/services/crypto/secretBox");
const { unreadableSecretMessage } = require("@/helpers/preferencesSecrets");
const {
  NOTIFY_MAX_ATTEMPTS,
  NOTIFY_RETRY_INTERVAL_MINUTES,
} = require("@/utils/retryPolicy");
const {
  createMailQueue,
  sendPendingEmails,
  sendNow,
  LEASE_MS,
} = require("./outbox");

const NOW = new Date("2026-09-30T10:00:00Z");

// ── Запросы к Mongo ─────────────────────────────────────────────────────────

test("claim: одно атомарное findOneAndUpdate — аренда, попытки, пауза, самое старое", async () => {
  const calls = [];
  const model = {
    findOneAndUpdate: async (...args) => {
      calls.push(args);
      return null;
    },
  };
  const queue = createMailQueue({ model, now: () => NOW });

  assert.equal(await queue.claim("lease-1"), null);
  const [[filter, update, options]] = calls;
  assert.deepEqual(filter, {
    instrument: "email",
    sent: false,
    failed: false,
    attemptsCounter: { $lt: NOTIFY_MAX_ATTEMPTS },
    $and: [
      { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: NOW } }] },
      {
        $or: [
          { attemptsCounter: 0 },
          {
            updatedAt: {
              $lt: new Date(NOW.getTime() - NOTIFY_RETRY_INTERVAL_MINUTES * 60000),
            },
          },
        ],
      },
    ],
  });
  assert.deepEqual(update, {
    $set: { leaseUntil: new Date(NOW.getTime() + LEASE_MS), leaseId: "lease-1" },
  });
  assert.deepEqual(options, {
    sort: { createdAt: 1 },
    returnDocument: "after",
    timestamps: false,
  });
});

test("ack и drop действуют только по своей аренде", async () => {
  const calls = [];
  const model = {
    updateOne: async (...args) => {
      calls.push(["updateOne", ...args]);
      return { matchedCount: 0 };
    },
    deleteOne: async (...args) => {
      calls.push(["deleteOne", ...args]);
      return { deletedCount: 1 };
    },
  };
  const queue = createMailQueue({ model, now: () => NOW });

  assert.equal(
    await queue.ack({ _id: "n1" }, "lease-1", { sent: true, attemptsCounter: 1 }),
    false,
  );
  await queue.drop({ _id: "n2" }, "lease-1");

  assert.deepEqual(calls, [
    [
      "updateOne",
      { _id: "n1", leaseId: "lease-1" },
      { $set: { sent: true, attemptsCounter: 1, leaseUntil: null, leaseId: null } },
    ],
    ["deleteOne", { _id: "n2", leaseId: "lease-1" }],
  ]);
});

// ── Разбор пачки ────────────────────────────────────────────────────────────

// Очередь в памяти с правилами аренды и предела попыток Mongo-запроса. Захват
// синхронный, то есть атомарный — как findOneAndUpdate. Паузу между попытками
// (updatedAt) она не держит: письмо после неудачи ниже предела берётся снова
// сразу, поэтому тесты с отказом ставят письму последнюю попытку.
const memoryQueue = (docs, clock) => {
  const acks = [];
  const drops = [];
  const owned = (notification, leaseId) =>
    docs.find((doc) => doc._id === notification._id && doc.leaseId === leaseId);

  return {
    acks,
    drops,
    claim: async (leaseId) => {
      const now = clock();
      const doc = docs.find(
        (item) =>
          !item.sent &&
          !item.failed &&
          !item.dropped &&
          item.attemptsCounter < NOTIFY_MAX_ATTEMPTS &&
          (!item.leaseUntil || item.leaseUntil <= now),
      );
      if (!doc) return null;
      doc.leaseUntil = new Date(now.getTime() + LEASE_MS);
      doc.leaseId = leaseId;
      return { ...doc };
    },
    ack: async (notification, leaseId, fields) => {
      const doc = owned(notification, leaseId);
      if (!doc) return false;
      Object.assign(doc, fields, { leaseUntil: null, leaseId: null });
      acks.push({ id: doc._id, fields });
      return true;
    },
    drop: async (notification, leaseId) => {
      const doc = owned(notification, leaseId);
      if (doc) doc.dropped = true;
      drops.push(notification._id);
    },
  };
};

const letter = (id, extra = {}) => ({
  _id: id,
  instrument: "email",
  to: { email: `${id}@example.ru` },
  title: "Уведомление",
  text: "<p>Текст</p>",
  attemptsCounter: 0,
  sent: false,
  failed: false,
  ...extra,
});

const delivered = (notification) => ({
  message: { success: true },
  exhausted: false,
  fields: { attemptsCounter: notification.attemptsCounter + 1, sent: true },
});

// Попытка, не принёсшая письма: SMTP ответил отказом, предел попыток не исчерпан
const undelivered = (notification) => ({
  message: { success: false, failure: { state: "Сервер не отвечает", hint: "" } },
  exhausted: false,
  fields: { attemptsCounter: notification.attemptsCounter + 1, sent: false },
});

// Модели вокруг очереди: почта включена, заявки живы, учётки обычные, строка
// состояния канала пишется в никуда (healthWrite — чем подменить эту запись).
// channel — настройки канала целиком, когда тесту нужен настоящий отправщик
const stubModels = (
  t,
  {
    mailOn = true,
    channel,
    deletedTickets = [],
    serviceEmails = [],
    healthWrite = async () => ({ acknowledged: true }),
  } = {},
) => {
  t.mock.method(Preferences, "findOne", async () => ({
    notify: { byEmail: channel ?? { isActive: mailOn } },
  }));
  t.mock.method(Preferences, "updateOne", healthWrite);
  t.mock.method(Ticket, "findById", (id) => ({
    select: async () => (deletedTickets.includes(id) ? null : { _id: id }),
  }));
  t.mock.method(User, "findOne", (filter) => ({
    select: async () =>
      serviceEmails.includes(filter.email) ? { isServiceAccount: true } : null,
  }));
};

// Журнал в памяти: уровень, текст и метаданные каждой записи. Подмена заодно
// убирает строки winston из вывода теста.
const captureLog = (t) => {
  const entries = [];
  t.mock.method(logger, "log", (level, message, meta) => {
    entries.push({ level, message, meta });
  });
  return entries;
};

// Хроника заявки пишется только при ADD_TICKET_LOG и только письмам с заявкой;
// сохранение подменено — onSave получает текст события
const TICKET = new mongoose.Types.ObjectId().toString();
const stubTicketLog = (t, onSave) => {
  const before = process.env.ADD_TICKET_LOG;
  process.env.ADD_TICKET_LOG = "1";
  t.after(() => {
    if (before === undefined) delete process.env.ADD_TICKET_LOG;
    else process.env.ADD_TICKET_LOG = before;
  });
  t.mock.method(TicketLog.prototype, "save", async function save() {
    onSave(this.event);
    return this;
  });
};

test("два наложившихся прогона не отправляют одно письмо дважды", async (t) => {
  stubModels(t);
  const queue = memoryQueue([letter("n1"), letter("n2"), letter("n3")], () => NOW);
  const sent = [];
  const send = async (notification) => {
    sent.push(notification._id);
    // SMTP «думает» — второй прогон успевает войти в очередь
    await new Promise((resolve) => setImmediate(resolve));
    return delivered(notification);
  };

  await Promise.all([
    sendPendingEmails({ queue, send }),
    sendPendingEmails({ queue, send }),
  ]);

  assert.deepEqual([...sent].sort(), ["n1", "n2", "n3"]);
  assert.deepEqual(
    queue.acks.map((ack) => ack.id).sort(),
    ["n1", "n2", "n3"],
  );
});

test("сбой посреди письма: не уходит повторно, пока держится аренда", async (t) => {
  stubModels(t);
  let now = NOW;
  const queue = memoryQueue([letter("n1"), letter("n2")], () => now);
  const sent = [];
  let crashed = false;
  const send = async (notification) => {
    if (notification._id === "n1" && !crashed) {
      crashed = true;
      throw new Error("обрыв посреди отправки");
    }
    sent.push(notification._id);
    return delivered(notification);
  };

  await sendPendingEmails({ queue, send });
  await sendPendingEmails({ queue, send });
  assert.deepEqual(sent, ["n2"], "n1 взят повторно до конца аренды");

  now = new Date(NOW.getTime() + LEASE_MS);
  await sendPendingEmails({ queue, send });
  assert.deepEqual(sent, ["n2", "n1"]);
});

test("удалённая заявка и служебная учётка снимаются, письмо без адреса — failed", async (t) => {
  stubModels(t, { deletedTickets: ["t-gone"], serviceEmails: ["robot@example.ru"] });
  const queue = memoryQueue(
    [
      letter("n1", { ticketId: "t-gone" }),
      letter("n2", { to: {} }),
      letter("n3", { to: { email: "robot@example.ru" } }),
      letter("n4", { ticketId: "t-live" }),
    ],
    () => NOW,
  );
  const sent = [];
  const send = async (notification) => {
    sent.push(notification._id);
    return delivered(notification);
  };

  await sendPendingEmails({ queue, send });

  assert.deepEqual(queue.drops, ["n1", "n3"]);
  assert.deepEqual(queue.acks, [
    { id: "n2", fields: { failed: true } },
    { id: "n4", fields: { attemptsCounter: 1, sent: true } },
  ]);
  assert.deepEqual(sent, ["n4"]);
});

test("почта выключена — очередь не трогается", async (t) => {
  stubModels(t, { mailOn: false });
  let claims = 0;
  const queue = {
    claim: async () => {
      claims += 1;
      return null;
    },
  };

  await sendPendingEmails({ queue });
  assert.equal(claims, 0);
});

// ── Срок аренды ─────────────────────────────────────────────────────────────

test("аренда держит письмо пять минут: не отдаёт ни через две минуты, ни за миллисекунду до срока", async (t) => {
  stubModels(t);
  captureLog(t); // обрыв посреди письма пишется в журнал как ошибка
  let now = NOW;
  const queue = memoryQueue([letter("n1")], () => now);
  const sent = [];
  let crashed = false;
  const send = async (notification) => {
    if (!crashed) {
      crashed = true;
      throw new Error("обрыв посреди отправки");
    }
    sent.push(notification._id);
    return delivered(notification);
  };
  // Моменты заданы минутами, а не через LEASE_MS: проверяется сам срок, а не то,
  // что очередь согласна с собственной константой
  const minute = 60 * 1000;
  const after = (ms) => new Date(NOW.getTime() + ms);

  // Медленный, но живой SMTP-сервер тянет обмен минутами (замер — около 168 с),
  // а общего потолка у nodemailer нет: аренда обязана пережить такую отправку
  assert.equal(LEASE_MS, 5 * minute);

  await sendPendingEmails({ queue, send }); // письмо взято, прогон оборвался

  now = after(2 * minute); // прежний срок аренды
  await sendPendingEmails({ queue, send });
  now = after(5 * minute - 1);
  await sendPendingEmails({ queue, send });
  assert.deepEqual(sent, [], "письмо взято повторно, пока аренда жива");

  now = after(5 * minute);
  await sendPendingEmails({ queue, send });
  assert.deepEqual(sent, ["n1"]);
});

// ── Исход попытки ───────────────────────────────────────────────────────────

test("последняя попытка не удалась: письмо помечается failed, в хронике — «не было отправлено»", async (t) => {
  stubModels(t);
  const chronicle = [];
  stubTicketLog(t, (event) => chronicle.push(event));
  // Настоящая attempt, а не заглушка send: проверяется её решение «попытки
  // исчерпаны»
  t.mock.method(mailSend, "sendMail", async () => ({
    success: false,
    failure: { state: "Сервер не отвечает", hint: "" },
  }));
  const queue = memoryQueue(
    [letter("n1", { ticketId: TICKET, attemptsCounter: NOTIFY_MAX_ATTEMPTS - 1 })],
    () => NOW,
  );

  await sendPendingEmails({ queue });

  // Без failed письмо с исчерпанными попытками осталось бы неотправленным и
  // невидимым: брать его больше никто не станет
  assert.deepEqual(queue.acks, [
    {
      id: "n1",
      fields: { attemptsCounter: NOTIFY_MAX_ATTEMPTS, sent: false, failed: true },
    },
  ]);
  assert.deepEqual(chronicle, [
    "email-уведомление пользователю n1@example.ru не было отправлено",
  ]);
});

test("последняя попытка удалась: письмо отправлено, а не failed", async (t) => {
  stubModels(t);
  // Настоящая attempt: решение «попытки исчерпаны» принимает она
  t.mock.method(mailSend, "sendMail", async () => ({ success: true }));
  const queue = memoryQueue(
    [letter("n1", { attemptsCounter: NOTIFY_MAX_ATTEMPTS - 1 })],
    () => NOW,
  );

  await sendPendingEmails({ queue });

  // Письмо, ушедшее на третьей попытке, — отправленное. «sent» и «failed»
  // вместе в документе — ложь, по которой его потом читают в отчётах
  assert.deepEqual(queue.acks, [
    { id: "n1", fields: { attemptsCounter: NOTIFY_MAX_ATTEMPTS, sent: true } },
  ]);
});

test("отметка об исходе пишется раньше состояния канала и хроники заявки", async (t) => {
  const events = [];
  stubModels(t, {
    healthWrite: async () => {
      events.push("состояние канала");
      return { acknowledged: true };
    },
  });
  stubTicketLog(t, () => events.push("хроника"));
  const queue = memoryQueue([letter("n1", { ticketId: TICKET })], () => NOW);
  const traced = {
    ...queue,
    ack: async (...args) => {
      events.push("отметка");
      return queue.ack(...args);
    },
  };

  await sendPendingEmails({ queue: traced, send: async (n) => delivered(n) });

  // Между отправкой и отметкой — окно, где возможен дубль: всё остальное
  // стоит после неё
  assert.deepEqual(events, ["отметка", "состояние канала", "хроника"]);
});

test("сбой записи состояния канала не отменяет отметку и хронику и не рвёт разбор", async (t) => {
  const log = captureLog(t);
  const chronicle = [];
  stubModels(t, {
    healthWrite: async () => {
      throw new Error("Mongo: нет связи");
    },
  });
  stubTicketLog(t, (event) => chronicle.push(event));
  const queue = memoryQueue(
    [letter("n1", { ticketId: TICKET }), letter("n2", { ticketId: TICKET })],
    () => NOW,
  );

  await sendPendingEmails({ queue, send: async (n) => delivered(n) });

  // Обе отметки записаны, второе письмо взято — разбор не оборвался
  assert.deepEqual(queue.acks.map((ack) => ack.id), ["n1", "n2"]);
  // Хроника записана, хотя состояние канала записать не удалось
  assert.equal(chronicle.length, 2);
  // Сбой назван сбоем записи состояния, а не «не удалось отправить письмо»
  assert.deepEqual(log.filter((entry) => entry.level === "error"), []);
  assert.equal(
    log.filter((entry) => entry.message === "Не удалось записать состояние почтового канала")
      .length,
    2,
  );
});

// ── Отметка об исходе: повтор ───────────────────────────────────────────────

test("отметка не записалась с первого раза: повтор через паузы, письмо уходит один раз", async (t) => {
  const log = captureLog(t);
  const healthWrites = [];
  stubModels(t, {
    healthWrite: async () => {
      healthWrites.push("запись");
      return { acknowledged: true };
    },
  });
  const queue = memoryQueue([letter("n1")], () => NOW);
  let writes = 0;
  const flaky = {
    ...queue,
    ack: async (...args) => {
      writes += 1;
      if (writes < 3) throw new Error("Mongo: обрыв связи");
      return queue.ack(...args);
    },
  };
  const sent = [];
  const sleeps = [];

  await sendPendingEmails({
    queue: flaky,
    send: async (n) => {
      sent.push(n._id);
      return delivered(n);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(writes, 3, "отметку пробуют три раза");
  assert.deepEqual(sleeps, [200, 1000]);
  assert.deepEqual(sent, ["n1"], "письмо уходит один раз");
  assert.deepEqual(queue.acks.map((ack) => ack.id), ["n1"]);
  // Отметка в итоге записана — исход канала пишется как обычно
  assert.equal(healthWrites.length, 1);
  assert.deepEqual(log, [], "ни ошибок, ни предупреждений");
});

test("отметку не удалось записать за три попытки: отдельная строка журнала, разбор идёт дальше", async (t) => {
  const log = captureLog(t);
  const healthWrites = [];
  stubModels(t, {
    healthWrite: async () => {
      healthWrites.push("запись");
      return { acknowledged: true };
    },
  });
  const queue = memoryQueue([letter("n1"), letter("n2")], () => NOW);
  let writes = 0;
  const broken = {
    ...queue,
    ack: async (notification, leaseId, fields) => {
      if (notification._id !== "n1") return queue.ack(notification, leaseId, fields);
      writes += 1;
      throw new Error("Mongo: нет связи");
    },
  };
  const sent = [];
  const sleeps = [];

  await sendPendingEmails({
    queue: broken,
    send: async (n) => {
      sent.push(n._id);
      return delivered(n);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(writes, 3, "дольше трёх попыток не пробуют");
  assert.deepEqual(sleeps, [200, 1000]);
  assert.deepEqual(sent, ["n1", "n2"], "следующее письмо взято");
  assert.deepEqual(queue.acks.map((ack) => ack.id), ["n2"]);

  // Письмо ушло, поэтому это не «не удалось отправить»: у строки журнала своё
  // имя и уровень warn
  assert.deepEqual(log.filter((entry) => entry.level === "error"), []);
  const warns = log.filter((entry) => entry.level === "warn");
  assert.equal(warns.length, 1);
  assert.match(
    warns[0].message,
    /письмо отправлено, но отметка не записалась — возможна повторная отправка/i,
  );
  assert.equal(warns[0].meta.notificationId, "n1");
  assert.equal(warns[0].meta.error, "Mongo: нет связи");

  // Состояние канала записано только для n2: база только что трижды не
  // ответила, а n1 вернётся в очередь по истечении аренды — исход запишет тот
  // проход
  assert.equal(healthWrites.length, 1);
});

test("аренда уже чужая: это ответ базы, а не сбой, — отметка не повторяется", async (t) => {
  const log = captureLog(t);
  const healthWrites = [];
  stubModels(t, {
    healthWrite: async () => {
      healthWrites.push("запись");
      return { acknowledged: true };
    },
  });
  const queue = memoryQueue([letter("n1")], () => NOW);
  let writes = 0;
  const lost = {
    ...queue,
    ack: async () => {
      writes += 1;
      return false;
    },
  };
  const sleeps = [];

  await sendPendingEmails({
    queue: lost,
    send: async (n) => delivered(n),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(writes, 1);
  assert.deepEqual(sleeps, []);
  assert.deepEqual(
    log.map((entry) => [entry.level, entry.message]),
    [["warn", "Аренда письма истекла до подтверждения — исход не записан"]],
  );
  // Письмо реально ушло — исход канала записан всё равно
  assert.equal(healthWrites.length, 1);
});

test("отправка не удалась и отметку записать нельзя: журнал не говорит, что письмо отправлено", async (t) => {
  const log = captureLog(t);
  stubModels(t);
  const queue = memoryQueue([letter("n1")], () => NOW);
  const broken = {
    ...queue,
    ack: async () => {
      throw new Error("Mongo: нет связи");
    },
  };

  await sendPendingEmails({
    queue: broken,
    send: async (n) => undelivered(n),
    sleep: async () => {},
  });

  assert.deepEqual(log.filter((entry) => entry.level === "error"), []);
  const warns = log.filter((entry) => entry.level === "warn");
  assert.equal(warns.length, 1);
  assert.doesNotMatch(warns[0].message, /отправлено/);
  assert.match(warns[0].message, /не засчитана/);
});

// Срок теста — страховка от зависания: пауза, которая «не кончается», держит
// await run навсегда, а не роняет проверку
test("настоящая пауза между записями отметки: 200 мс, затем секунда — и она заканчивается", { timeout: 5000 }, async (t) => {
  stubModels(t);
  captureLog(t);
  // Время подменено: sleep не передаётся, работает настоящий defaultSleep, а
  // ждать по-настоящему не приходится. Без этой паузы, которая «не кончается»,
  // неудача записи отметки подвесила бы прогон и вместе с ним всю очередь
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queue = memoryQueue([letter("n1")], () => NOW);
  let writes = 0;
  const flaky = {
    ...queue,
    ack: async (...args) => {
      writes += 1;
      if (writes < 3) throw new Error("Mongo: обрыв связи");
      return queue.ack(...args);
    },
  };
  // Дать микрозадачам и таймерам-пустышкам отработать между шагами часов
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const run = sendPendingEmails({ queue: flaky, send: async (n) => delivered(n) });

  await flush();
  assert.equal(writes, 1, "первая запись — сразу");
  t.mock.timers.tick(199);
  await flush();
  assert.equal(writes, 1, "ещё ждём: 199 мс");
  t.mock.timers.tick(1);
  await flush();
  assert.equal(writes, 2, "вторая запись — через 200 мс");
  t.mock.timers.tick(999);
  await flush();
  assert.equal(writes, 2, "ещё ждём: 999 мс");
  t.mock.timers.tick(1);
  await run;
  assert.equal(writes, 3, "третья запись — через секунду, и прогон закончился");
  assert.deepEqual(queue.acks.map((ack) => ack.id), ["n1"]);
});

test("sendNow: не ушло — документ сохраняется один раз, с попыткой и failed", async (t) => {
  t.mock.method(Preferences, "findOne", async () => ({
    notify: { byEmail: { isActive: true } },
  }));
  t.mock.method(Preferences, "updateOne", async () => ({ acknowledged: true }));
  t.mock.method(mailSend, "sendMail", async () => ({
    success: false,
    failure: { state: "Сервер не отвечает", hint: "" },
  }));
  const notification = new Notification({
    instrument: "email",
    to: { email: "user@example.ru" },
    title: "Код для входа",
    text: "<p>1234</p>",
  });
  const saves = [];
  t.mock.method(notification, "save", async function save() {
    saves.push(this.toObject());
    return this;
  });

  const result = await sendNow(notification);

  assert.equal(result.success, false);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].attemptsCounter, 1);
  assert.equal(saves[0].failed, true);
  assert.equal(saves[0].sent, false);
});

// ── Пароль SMTP не читается (D6, F1) ────────────────────────────────────────
// Настоящий отправщик, а не заглушка: решение «письму не ждать повторов»
// принимает вся цепочка — транспорт, sendMail, attempt, отметка, строка
// состояния

// Шифртекст нашего формата, но под другим ключом — как после потери APP_ENC_KEY
const foreignCiphertext = (plaintext) => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
};

// Канал уведомлений. Адрес — локальный: сокет, если бы он открылся, ушёл бы не
// наружу, а в отказ на этой же машине
const smtpChannel = (pass) => ({
  isActive: true,
  host: "127.0.0.1",
  port: 2525,
  security: "none",
  user: "hd",
  pass,
  sendFromEmail: "hd@example.ru",
});

// Пароль к серверу мог бы уйти только через сокет: любая попытка его открыть
// записывается и обрывается
const trackSockets = (t) => {
  const attempts = [];
  const refuse = (kind) => () => {
    attempts.push(kind);
    throw new Error(`открыт сокет: ${kind}`);
  };
  t.mock.method(net.Socket.prototype, "connect", refuse("net.Socket#connect"));
  t.mock.method(net, "connect", refuse("net.connect"));
  t.mock.method(net, "createConnection", refuse("net.createConnection"));
  t.mock.method(tls, "connect", refuse("tls.connect"));
  return attempts;
};

// Строка состояния канала — модульное состояние (ошибка с тем же текстом
// пишется не чаще раза в минуту): перед тестом канал «в порядке», чтобы первая
// ошибка писалась сразу. Записи самого сброса из healthWrites убираются
const resetChannelHealth = async (healthWrites) => {
  await health.recordOk(health.SMTP, { message: true });
  healthWrites.length = 0;
};

const healthSets = (healthWrites) => healthWrites.map((update) => update.$set);

test("пароль SMTP не читается: письмо failed после одной попытки, строка состояния просит ввести заново, сокета нет", async (t) => {
  const plaintext = "smtp-pass-секрет";
  const blob = foreignCiphertext(plaintext);
  const healthWrites = [];
  stubModels(t, {
    channel: smtpChannel(blob),
    healthWrite: async (filter, update) => {
      healthWrites.push(update);
      return { acknowledged: true };
    },
  });
  await resetChannelHealth(healthWrites);
  const sockets = trackSockets(t);
  const log = captureLog(t);
  const chronicle = [];
  stubTicketLog(t, (event) => chronicle.push(event));
  let now = NOW;
  const queue = memoryQueue([letter("n1", { ticketId: TICKET })], () => now);

  await sendPendingEmails({ queue });

  // Одна попытка и сразу failed: ни повторов, ни вечной аренды
  assert.deepEqual(queue.acks, [
    { id: "n1", fields: { attemptsCounter: 1, sent: false, failed: true } },
  ]);
  assert.deepEqual(sockets, [], "к серверу обратились с нечитаемым паролем");

  // Строка состояния в настройках: что случилось и что делать
  const writes = healthSets(healthWrites);
  assert.equal(writes.length, 1);
  assert.equal(
    writes[0]["notify.byEmail.health.lastError"],
    unreadableSecretMessage("notify.byEmail.pass"),
  );
  assert.ok(writes[0]["notify.byEmail.health.lastErrorHint"]);
  assert.equal(healthWrites[0].$inc["notify.byEmail.health.consecutiveFailures"], 1);

  // В хронике заявки письмо не отправлено, а не «ошибка, попробуем ещё»
  assert.deepEqual(chronicle, [
    "email-уведомление пользователю n1@example.ru не было отправлено",
  ]);

  // Одна ограниченная строка журнала: не «письмо из очереди не удалось»
  // (после неё письмо оставалось бы в аренде) и без шифртекста
  assert.deepEqual(
    log.map((entry) => [entry.level, entry.meta?.module]),
    [["error", "mailSend"]],
  );
  const everything = JSON.stringify([log, healthWrites, queue.acks]);
  for (const secret of [blob, plaintext]) {
    assert.ok(!everything.includes(secret), `в журнале или состоянии «${secret}»`);
  }

  // И дальше письмо никто не возьмёт: ни следующий прогон, ни конец аренды
  now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  await sendPendingEmails({ queue });
  assert.equal(queue.acks.length, 1);
});

test("пароль SMTP не читается: пачка писем — у каждого одна попытка, и сокета по-прежнему нет", async (t) => {
  stubModels(t, { channel: smtpChannel(foreignCiphertext("smtp-pass")) });
  const sockets = trackSockets(t);
  captureLog(t);
  const queue = memoryQueue([letter("n1"), letter("n2"), letter("n3")], () => NOW);

  await sendPendingEmails({ queue });

  assert.deepEqual(
    queue.acks.map((ack) => [ack.id, ack.fields.attemptsCounter, ack.fields.failed]),
    [["n1", 1, true], ["n2", 1, true], ["n3", 1, true]],
  );
  assert.deepEqual(sockets, []);
});

test("контроль стенда: с читаемым паролем сокет пытаются открыть, а обычный отказ повтора не отменяет", async (t) => {
  stubModels(t, { channel: smtpChannel(encryptSecret("smtp-pass")) });
  const sockets = trackSockets(t);
  captureLog(t);
  const memory = memoryQueue([letter("n1")], () => NOW);
  // Паузы до повтора (15 минут) очередь в памяти не держит: за прогон письмо
  // берётся один раз, как и в настоящей очереди
  let taken = false;
  const queue = {
    ...memory,
    claim: async (leaseId) => (taken ? null : ((taken = true), memory.claim(leaseId))),
  };

  await sendPendingEmails({ queue });

  assert.ok(sockets.length > 0, "попытка соединения осталась незамеченной");
  // Сервер недоступен — первая попытка из трёх, письмо ещё не failed
  assert.deepEqual(memory.acks, [
    { id: "n1", fields: { attemptsCounter: 1, sent: false } },
  ]);
});

test("sendNow: пароль SMTP не читается — не бросает, документ failed после одной попытки, вызывающий получает причину", async (t) => {
  const blob = foreignCiphertext("smtp-pass");
  const healthWrites = [];
  t.mock.method(Preferences, "findOne", async () => ({
    notify: { byEmail: smtpChannel(blob) },
  }));
  t.mock.method(Preferences, "updateOne", async (filter, update) => {
    healthWrites.push(update);
    return { acknowledged: true };
  });
  await resetChannelHealth(healthWrites);
  const sockets = trackSockets(t);
  captureLog(t);
  const notification = new Notification({
    instrument: "email",
    to: { email: "user@example.ru" },
    title: "Код для входа",
    text: "<p>1234</p>",
  });
  const saves = [];
  t.mock.method(notification, "save", async function save() {
    saves.push(this.toObject());
    return this;
  });

  const result = await sendNow(notification);

  // Экран узнаёт причину из ответа, а не из исключения посреди запроса
  assert.equal(result.success, false);
  assert.equal(result.failure.state, unreadableSecretMessage("notify.byEmail.pass"));
  assert.equal(saves.length, 1);
  assert.equal(saves[0].attemptsCounter, 1);
  assert.equal(saves[0].failed, true);
  assert.equal(saves[0].sent, false);
  assert.deepEqual(sockets, []);
  assert.equal(
    healthSets(healthWrites)[0]["notify.byEmail.health.lastError"],
    unreadableSecretMessage("notify.byEmail.pass"),
  );
});
