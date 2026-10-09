// node --test services/mail/transport.test.js
const crypto = require("node:crypto");

// Ключ шифрования теста — до первого обращения к secretBox (он кэширует ключ)
process.env.APP_ENC_KEY = crypto.randomBytes(32).toString("base64");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { encryptSecret } = require("../crypto/secretBox");
const {
  SecretUnreadableError,
  unreadableSecretMessage,
} = require("../../helpers/preferencesSecrets");
const {
  readSecret,
  buildImapConfig,
  buildSmtpOptions,
  describeMailError,
} = require("./transport");

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

// Нечитаемый шифртекст называет поле настроек, а не падает сырой ошибкой GCM
const unreadable = (path) => (error) => {
  assert.ok(error instanceof SecretUnreadableError, String(error));
  assert.equal(error.path, path);
  return true;
};

// ── Чтение секрета ──────────────────────────────────────────────────────────

test("пустое, открытый текст и свой шифртекст читаются как прежде", () => {
  assert.equal(readSecret("", "mailbox.password"), "");
  assert.equal(readSecret(undefined, "mailbox.password"), "");
  assert.equal(readSecret("plain-old", "mailbox.password"), "plain-old");
  assert.equal(readSecret(encryptSecret("s3cret"), "mailbox.password"), "s3cret");
});

test("шифртекст под чужим ключом или битый — SecretUnreadableError с путём", () => {
  assert.throws(
    () => readSecret(foreignCiphertext("s3cret"), "notify.byEmail.pass"),
    unreadable("notify.byEmail.pass"),
  );
  assert.throws(() => readSecret("v1:broken", "mailbox.password"), unreadable("mailbox.password"));
});

test("пароль ящика: нечитаемый не превращается в конфиг подключения", () => {
  const mailbox = {
    address: "support@example.ru",
    host: "imap.example.ru",
    password: foreignCiphertext("imap-pass"),
  };

  assert.throws(() => buildImapConfig(mailbox), unreadable("mailbox.password"));
  // А читаемый — пароль в конфиге
  assert.equal(
    buildImapConfig({ ...mailbox, password: encryptSecret("imap-pass") }).imap.password,
    "imap-pass",
  );
  assert.equal(buildImapConfig({ ...mailbox, password: "legacy" }).imap.password, "legacy");
});

test("пароль SMTP: нечитаемый не превращается в настройки транспорта", () => {
  const channel = {
    host: "smtp.example.ru",
    user: "hd",
    pass: foreignCiphertext("smtp-pass"),
  };

  assert.throws(() => buildSmtpOptions(channel), unreadable("notify.byEmail.pass"));
  assert.throws(
    () => buildSmtpOptions({ ...channel, authMethod: "password" }),
    unreadable("notify.byEmail.pass"),
  );
  assert.deepEqual(buildSmtpOptions({ ...channel, pass: encryptSecret("smtp-pass") }).auth, {
    user: "hd",
    pass: "smtp-pass",
  });
});

test("SMTP без авторизации: пароль не читается вовсе, нечитаемый ему не помеха", () => {
  const options = buildSmtpOptions({
    host: "relay.example.ru",
    authMethod: "none",
    pass: foreignCiphertext("old-smtp-pass"),
  });

  assert.equal(options.auth, undefined);
  assert.equal(options.host, "relay.example.ru");
});

// ── Таймеры отправки ────────────────────────────────────────────────────────

test("поиск адреса SMTP-сервера: таймаут первой попытки — 2 секунды, а не 30 по умолчанию", () => {
  // Это таймаут первой попытки запроса к резолверу: молчащий резолвер отпускает запрос
  // примерно через 14 таймаутов (27 с при 2000 мс, замер). При 15 с выходило бы 3,5
  // минуты на запрос и 7 минут вместе с AAAA — дольше аренды письма в очереди
  // (services/mail/outbox, LEASE_MS — пять минут)
  assert.equal(buildSmtpOptions({ host: "smtp.example.ru" }).dnsTimeout, 2000);
});

// ── Строка состояния ────────────────────────────────────────────────────────

test("нечитаемый пароль — строка состояния «введите заново», а не «не удалось подключиться»", () => {
  for (const path of ["mailbox.password", "notify.byEmail.pass"]) {
    const error = (() => {
      try {
        readSecret(foreignCiphertext("x"), path);
      } catch (caught) {
        return caught;
      }
    })();

    // Хост и порт у ошибки нет: к серверу никто не обращался
    const description = describeMailError(error, { host: "smtp.example.ru", port: 465 });

    assert.equal(description.state, unreadableSecretMessage(path));
    assert.equal(typeof description.hint, "string");
    assert.ok(description.hint.length > 0);
    // Советы про адрес, порт и шифрование тут ни при чём
    assert.doesNotMatch(
      `${description.state} ${description.hint}`,
      /подключиться|порт|режим шифрования/i,
    );
  }
});

test("остальные ошибки описываются как прежде", () => {
  assert.equal(
    describeMailError(Object.assign(new Error("535"), { code: "EAUTH" })).state,
    "Сервер отклонил пароль",
  );
  assert.equal(
    describeMailError(new Error("что-то"), { host: "smtp.example.ru", port: 465 }).state,
    "Не удалось подключиться к smtp.example.ru:465",
  );
});
