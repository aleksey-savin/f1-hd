// node --test middleware/emailHandling.secrets.test.js
require("module-alias/register");
const crypto = require("node:crypto");
const Module = require("node:module");

// Ключ шифрования теста — до первого обращения к secretBox (он кэширует ключ)
process.env.APP_ENC_KEY = crypto.randomBytes(32).toString("base64");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const tls = require("node:tls");
const mongoose = require("mongoose");

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

/**
 * Модель заявок подменена в require.cache до загрузки обработчика:
 * models/ticket.js на верхнем уровне зовёт initCounter(), и без базы в выводе
 * остаётся «Failed to initialize counter» (тот же приём, что в
 * controllers/company.access.test.js). До заявок сбор писем здесь не доходит.
 */
const ticketModel = require.resolve("@/models/ticket");
const ticketStub = new Module(ticketModel);
ticketStub.filename = ticketModel;
ticketStub.loaded = true;
ticketStub.exports = { Ticket: {} };
require.cache[ticketModel] = ticketStub;

const Preferences = require("@/models/preferences");
const logger = require("@/utils/logger");
const health = require("@/services/mail/health");
const { encryptSecret } = require("@/services/crypto/secretBox");
const { unreadableSecretMessage } = require("@/helpers/preferencesSecrets");
const { handleNewEmails } = require("./emailHandling");

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

// Ящик, включённый для сбора. Адрес — локальный: сокет, если бы он открылся,
// ушёл бы не наружу, а в отказ на этой же машине
const prefsWith = (password) => ({
  mailbox: {
    isActive: true,
    address: "support@example.ru",
    host: "127.0.0.1",
    port: 1993,
    security: "ssl",
    password,
  },
  defaultApplicant: { _id: new mongoose.Types.ObjectId() },
});

// Настройки «из базы» и запись состояния канала в списке updates. Состояние
// канала — модульное (ошибка с тем же текстом пишется не чаще раза в минуту):
// канал сначала «в порядке», чтобы первая ошибка писалась сразу
const stubPreferences = async (t, password, updates) => {
  t.mock.method(Preferences, "findOne", async () => prefsWith(password));
  t.mock.method(Preferences, "updateOne", async (filter, update) => {
    updates.push(update);
    return { acknowledged: true };
  });
  await health.recordOk(health.MAILBOX, { message: true });
  updates.length = 0;
};

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

const captureLog = (t) => {
  const entries = [];
  t.mock.method(logger, "log", (level, message, meta) => {
    entries.push({ level, message, meta });
  });
  return entries;
};

test("пароль ящика не читается: сокет не открыт, одна строка состояния «введите заново», в журнале строка без стека", async (t) => {
  const plaintext = "imap-pass-секрет";
  const blob = foreignCiphertext(plaintext);
  const updates = [];
  await stubPreferences(t, blob, updates);
  const sockets = trackSockets(t);
  const log = captureLog(t);

  await handleNewEmails();

  assert.deepEqual(sockets, [], "к серверу обратились с нечитаемым паролем");

  // Строка состояния: что случилось и что делать, а не «не удалось подключиться»
  assert.equal(updates.length, 1);
  const row = updates[0].$set;
  assert.equal(row["mailbox.health.lastError"], unreadableSecretMessage("mailbox.password"));
  assert.ok(row["mailbox.health.lastErrorHint"]);
  assert.doesNotMatch(JSON.stringify(updates), /подключиться|порт/i);

  // Журнал: одна строка уровня error, без стека и без «Critical error»
  assert.deepEqual(
    log.map((entry) => entry.level),
    ["error"],
  );
  assert.doesNotMatch(log[0].message, /Critical error/);
  assert.equal(log[0].meta.stack, undefined, "в журнале стек");
  assert.match(log[0].meta.error, /mailbox\.password/);
  const everything = JSON.stringify([log, updates]);
  for (const secret of [blob, plaintext]) {
    assert.ok(!everything.includes(secret), `в журнале или состоянии «${secret}»`);
  }

  // Следующие заходы крона (раз в 20 секунд): сокета по-прежнему нет, строка
  // состояния не переписывается заново — тот же текст не чаще раза в минуту, и в
  // журнале новых строк тоже нет (отдельный тест ниже)
  await handleNewEmails();
  await handleNewEmails();
  assert.deepEqual(sockets, []);
  assert.equal(updates.length, 1);
  assert.equal(log.length, 1);
  assert.ok(log.every((entry) => entry.meta.stack === undefined));
});

// Крон ходит раз в 20 секунд, а причина за это время не меняется: строка в журнале —
// не чаще раза в минуту на ящик, как и запись в строку состояния (services/mail/health),
// а не ~4300 одинаковых строк в сутки на выходных. Время подменено (Date) и сдвинуто
// вперёд от прежних тестов файла: их строки записаны в настоящем времени
test("пароль ящика не читается: строка в журнале — не чаще раза в минуту, а не на каждый заход крона", async (t) => {
  const updates = [];
  await stubPreferences(t, foreignCiphertext("imap-pass"), updates);
  trackSockets(t);
  const log = captureLog(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 10 * 60 * 1000 });
  const lines = () => log.filter((entry) => entry.level === "error");

  await handleNewEmails();
  assert.equal(lines().length, 1, "первый заход: строка нужна");

  // 20 и 40 секунд спустя: причина та же, строки нет
  t.mock.timers.tick(20 * 1000);
  await handleNewEmails();
  t.mock.timers.tick(20 * 1000);
  await handleNewEmails();
  assert.equal(lines().length, 1, "строка повторена внутри минуты");

  // Минута прошла: одна строка снова (проблема всё ещё есть, а лог не должен молчать)
  t.mock.timers.tick(20 * 1000);
  await handleNewEmails();
  assert.equal(lines().length, 2, "через минуту строки нет");

  // И снова тишина до следующей минуты
  t.mock.timers.tick(20 * 1000);
  await handleNewEmails();
  assert.equal(lines().length, 2);
  assert.ok(lines().every((entry) => /не читается|unreadable/i.test(entry.message)));
});

test("контроль стенда: с читаемым паролем сокет пытаются открыть, а сбой соединения описан как прежде", async (t) => {
  const updates = [];
  await stubPreferences(t, encryptSecret("imap-pass"), updates);
  const sockets = trackSockets(t);
  const log = captureLog(t);

  await handleNewEmails();

  assert.ok(sockets.length > 0, "попытка соединения осталась незамеченной");
  assert.equal(
    updates[0].$set["mailbox.health.lastError"],
    "Не удалось подключиться к 127.0.0.1:1993",
  );
  // Прочие сбои — прежняя «критическая» строка со стеком
  const critical = log.filter((entry) => entry.message === "Critical error in email processing");
  assert.equal(critical.length, 1);
  assert.ok(critical[0].meta.stack);
});
