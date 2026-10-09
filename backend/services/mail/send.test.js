// node --test services/mail/send.test.js
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
const { sendMail } = require("./send");

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
const channel = (pass, extra = {}) => ({
  host: "127.0.0.1",
  port: 2525,
  security: "none",
  user: "hd",
  pass,
  sendFromEmail: "hd@example.ru",
  ...extra,
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

// Транспорт-пустышка: письмо «уходит» без сети
const fakeTransport = (t, sendMailImpl) =>
  t.mock.method(nodemailer, "createTransport", () => ({ sendMail: sendMailImpl }));

const send = (creds) => sendMail(creds, "user@example.ru", "Тема", "", "<p>Текст</p>");

// ── Нечитаемый пароль ───────────────────────────────────────────────────────

test("пароль SMTP не читается: письмо не ушло, причина названа, повтор не предлагается, сокета нет", async (t) => {
  const sockets = trackSockets(t);
  const createTransport = fakeTransport(t, async () => ({ messageId: "m1" }));
  captureLog(t);

  const result = await send(channel(foreignCiphertext("smtp-pass")));

  assert.equal(result.success, false);
  // Пароль не прочитается и со второго раза: письму нет смысла ждать попыток
  assert.equal(result.retryable, false);
  assert.equal(result.failure.state, unreadableSecretMessage("notify.byEmail.pass"));
  assert.equal(typeof result.failure.hint, "string");
  assert.equal(createTransport.mock.callCount(), 0, "транспорт собран с нечитаемым паролем");
  assert.deepEqual(sockets, [], "к серверу обратились");
});

test("в журнале одна ограниченная строка: без стека, шифртекста и значения пароля", async (t) => {
  trackSockets(t);
  fakeTransport(t, async () => ({ messageId: "m1" }));
  const log = captureLog(t);
  const plaintext = "smtp-pass-секрет";
  const blob = foreignCiphertext(plaintext);

  await send(channel(blob));

  assert.equal(log.length, 1);
  assert.equal(log[0].level, "error");
  assert.match(log[0].message, /пароль SMTP не читается/);
  assert.deepEqual(Object.keys(log[0].meta).sort(), ["error", "module"]);
  assert.match(log[0].meta.error, /notify\.byEmail\.pass/);

  const everything = JSON.stringify(log);
  for (const secret of [blob, plaintext]) {
    assert.ok(!everything.includes(secret), `в журнале «${secret}»`);
  }
  assert.doesNotMatch(everything, /\n\s+at /, "в журнале стек");
});

test("контроль стенда: с читаемым паролем сокет пытаются открыть, и стенд это видит", async (t) => {
  const sockets = trackSockets(t);
  captureLog(t);

  const result = await send(channel(encryptSecret("smtp-pass")));

  assert.equal(result.success, false);
  assert.ok(sockets.length > 0, "попытка соединения осталась незамеченной");
});

test("SMTP без авторизации: нечитаемый пароль письму не помеха", async (t) => {
  const createTransport = fakeTransport(t, async () => ({ messageId: "m1" }));
  captureLog(t);

  const result = await send(
    channel(foreignCiphertext("old-smtp-pass"), { authMethod: "none" }),
  );

  assert.equal(result.success, true);
  assert.equal(createTransport.mock.callCount(), 1);
  assert.equal(createTransport.mock.calls[0].arguments[0].auth, undefined);
});

// ── Прочие отказы: как прежде ───────────────────────────────────────────────

test("обычный отказ сервера — прежний failure, и повтор по-прежнему возможен", async (t) => {
  fakeTransport(t, async () => {
    throw Object.assign(new Error("Invalid login"), { code: "EAUTH" });
  });
  captureLog(t);

  const result = await send(channel(encryptSecret("smtp-pass")));

  assert.equal(result.success, false);
  assert.equal(result.failure.state, "Сервер отклонил пароль");
  // retryable есть только у отказа, который повтором не исправить
  assert.equal(result.retryable, undefined);
});

test("нет APP_ENC_KEY — ошибка развёртывания: не «введите заново» и не «письмо не ушло», а громкий отказ", () => {
  // Свой процесс: secretBox кэширует найденный ключ, а здесь нужен момент до него
  const script = `
    require("module-alias/register");
    const { sendMail } = require("@/services/mail/send");
    const { buildImapConfig, buildSmtpOptions } = require("@/services/mail/transport");
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
        buildImapConfig({ address: "a@example.ru", host: "127.0.0.1", password: blob }),
      );
      out.smtp = await outcome(() =>
        buildSmtpOptions({ host: "127.0.0.1", user: "hd", pass: blob }),
      );
      out.send = await outcome(() =>
        sendMail(
          { host: "127.0.0.1", user: "hd", pass: blob, sendFromEmail: "hd@example.ru" },
          "user@example.ru", "t", "", "",
        ),
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

  for (const name of ["imap", "smtp", "send"]) {
    assert.equal(out[name].returned, undefined, `${name}: отказ превращён в обычный результат`);
    assert.equal(out[name].threw, "Error", `${name}: ошибка названа SecretUnreadableError`);
    assert.match(out[name].message, /^APP_ENC_KEY/);
  }
});
