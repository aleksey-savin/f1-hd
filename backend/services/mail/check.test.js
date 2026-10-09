// node --test services/mail/check.test.js
require("module-alias/register");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Ключ шифрования теста — до первого обращения к secretBox (он кэширует ключ)
process.env.APP_ENC_KEY = crypto.randomBytes(32).toString("base64");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const tls = require("node:tls");
const nodemailer = require("nodemailer");

const logger = require("@/utils/logger");
const { encryptSecret } = require("@/services/crypto/secretBox");
const { unreadableSecretMessage } = require("@/helpers/preferencesSecrets");
const { checkMailbox, sendTestEmail } = require("./check");

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

// Ящик и канал уведомлений. Адрес — локальный: сокет, если бы он открылся, ушёл бы
// не наружу, а в отказ на этой же машине
const mailbox = (password) => ({
  address: "support@example.ru",
  host: "127.0.0.1",
  port: 1993,
  security: "ssl",
  password,
});
const channel = (pass) => ({
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

const captureLog = (t) => {
  const entries = [];
  t.mock.method(logger, "log", (level, message, meta) => {
    entries.push({ level, message, meta });
  });
  return entries;
};

// Кнопки «Проверить» в настройках. Ответ — обычный 200 с { ok, state, hint }: экран
// уже показывает так любой отказ проверки (describeCheckResult: state — заголовок,
// hint — подсказка), поэтому нечитаемый пароль называется там же, а не сводится к
// безликому «Не удалось выполнить проверку» после ответа 500.

test("проверка ящика: пароль не читается — ответ с причиной «введите заново», сокета нет", async (t) => {
  const sockets = trackSockets(t);
  const log = captureLog(t);
  const plaintext = "imap-pass-секрет";
  const blob = foreignCiphertext(plaintext);

  const result = await checkMailbox(mailbox(blob));

  assert.equal(result.ok, false);
  assert.equal(result.state, unreadableSecretMessage("mailbox.password"));
  assert.equal(typeof result.hint, "string");
  assert.ok(result.hint.length > 0, "подсказка пуста");
  assert.deepEqual(sockets, [], "к серверу обратились с нечитаемым паролем");

  // Ни шифртекста, ни пароля — ни в ответе, ни в журнале
  const everything = JSON.stringify([result, log]);
  for (const secret of [blob, plaintext]) {
    assert.ok(!everything.includes(secret), `в ответе или журнале «${secret}»`);
  }
  assert.ok(log.every((entry) => entry.meta?.stack === undefined), "в журнале стек");
});

test("тестовое письмо: пароль SMTP не читается — ответ с причиной «введите заново», транспорт не собран", async (t) => {
  const sockets = trackSockets(t);
  const createTransport = t.mock.method(nodemailer, "createTransport", () => {
    throw new Error("транспорт собран с нечитаемым паролем");
  });
  const log = captureLog(t);
  const plaintext = "smtp-pass-секрет";
  const blob = foreignCiphertext(plaintext);

  const result = await sendTestEmail(channel(blob), "admin@example.ru");

  assert.equal(result.ok, false);
  assert.equal(result.state, unreadableSecretMessage("notify.byEmail.pass"));
  assert.equal(typeof result.hint, "string");
  assert.ok(result.hint.length > 0, "подсказка пуста");
  assert.equal(createTransport.mock.callCount(), 0);
  assert.deepEqual(sockets, [], "к серверу обратились с нечитаемым паролем");

  const everything = JSON.stringify([result, log]);
  for (const secret of [blob, plaintext]) {
    assert.ok(!everything.includes(secret), `в ответе или журнале «${secret}»`);
  }
  assert.ok(log.every((entry) => entry.meta?.stack === undefined), "в журнале стек");
});

test("контроль стенда: с читаемым паролем проверки идут к серверу, а сбой описан как прежде", async (t) => {
  const sockets = trackSockets(t);
  captureLog(t);

  const imap = await checkMailbox(mailbox(encryptSecret("imap-pass")));
  assert.ok(sockets.length > 0, "попытка соединения с ящиком осталась незамеченной");
  assert.equal(imap.ok, false);
  assert.equal(imap.state, "Не удалось подключиться к 127.0.0.1:1993");

  sockets.length = 0;
  const smtp = await sendTestEmail(channel(encryptSecret("smtp-pass")), "admin@example.ru");
  assert.ok(sockets.length > 0, "попытка соединения с SMTP осталась незамеченной");
  assert.equal(smtp.ok, false);
  assert.doesNotMatch(smtp.state, /не читается/);
});

test("нет APP_ENC_KEY — ошибка развёртывания: проверки не прячут её под «введите заново»", () => {
  // Свой процесс: secretBox кэширует найденный ключ, а здесь нужен момент до него
  const script = `
    require("module-alias/register");
    const { checkMailbox, sendTestEmail } = require("@/services/mail/check");
    const blob = ${JSON.stringify(foreignCiphertext("x"))};
    const outcome = async (run) => {
      try {
        return { returned: JSON.stringify(await run()) };
      } catch (error) {
        return { threw: error.name, message: error.message };
      }
    };
    (async () => {
      const out = {};
      out.imap = await outcome(() =>
        checkMailbox({ address: "a@example.ru", host: "127.0.0.1", password: blob }),
      );
      out.smtp = await outcome(() =>
        sendTestEmail({ host: "127.0.0.1", user: "hd", pass: blob, sendFromEmail: "hd@example.ru" }, "u@example.ru"),
      );
      console.log("RESULT " + JSON.stringify(out));
    })();
  `;
  const run = spawnSync(process.execPath, ["-e", script], {
    cwd: path.join(__dirname, "../.."),
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, APP_ENC_KEY: "", MIKROTIK_ENC_KEY: "" },
  });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  const out = JSON.parse(run.stdout.split("\n").find((line) => line.startsWith("RESULT ")).slice(7));

  // «Введите пароль заново» не лечит сервер без ключа: сломан сам запуск
  for (const name of ["imap", "smtp"]) {
    assert.equal(out[name].returned, undefined, `${name}: отказ превращён в обычный ответ`);
    assert.equal(out[name].threw, "Error");
    assert.match(out[name].message, /^APP_ENC_KEY/);
  }
});
