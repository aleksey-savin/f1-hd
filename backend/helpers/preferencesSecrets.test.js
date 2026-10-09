// node --test helpers/preferencesSecrets.test.js
require("module-alias/register");
const crypto = require("node:crypto");

// Ключ шифрования теста — до первого обращения к secretBox (он кэширует ключ)
process.env.APP_ENC_KEY = crypto.randomBytes(32).toString("base64");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const { encryptSecret } = require("../services/crypto/secretBox");
const {
  SECRET_PATHS,
  SECRET_LABELS,
  SecretUnreadableError,
  readStoredSecret,
  isSecretReadable,
  findUnreadableSecret,
  createLenientSecretReader,
  unreadableSecretMessage,
} = require("./preferencesSecrets");

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

test("пустое, открытый текст и свой шифртекст читаются как прежде", () => {
  assert.equal(readStoredSecret("", "mailbox.password"), "");
  assert.equal(readStoredSecret(undefined), "");
  assert.equal(readStoredSecret("plain-old", "mailbox.password"), "plain-old");
  assert.equal(readStoredSecret(encryptSecret("s3cret"), "mailbox.password"), "s3cret");
});

test("шифртекст под чужим ключом или битый — SecretUnreadableError с путём", () => {
  assert.throws(
    () => readStoredSecret(foreignCiphertext("s3cret"), "notify.byEmail.pass"),
    (error) => {
      assert.ok(error instanceof SecretUnreadableError);
      assert.equal(error.path, "notify.byEmail.pass");
      assert.match(error.message, /notify\.byEmail\.pass cannot be decrypted/);
      return true;
    },
  );
  assert.throws(
    () => readStoredSecret("v1:broken", "ai.openai.apiKey"),
    SecretUnreadableError,
  );
});

test("ответ 422 называет поле так, как оно подписано в настройках", () => {
  assert.equal(
    unreadableSecretMessage("mailbox.password"),
    "Сохранённое значение «Пароль почтового ящика» не читается — введите его заново",
  );
  for (const path of SECRET_PATHS) {
    assert.ok(SECRET_LABELS[path], `нет подписи для ${path}`);
  }
});

test("для инвариантов нечитаемый секрет — незаданный", () => {
  assert.equal(isSecretReadable(encryptSecret("x"), "ai.openai.apiKey"), true);
  assert.equal(isSecretReadable(foreignCiphertext("x"), "ai.openai.apiKey"), false);

  const secrets = createLenientSecretReader();
  assert.equal(secrets.read(foreignCiphertext("x"), "ai.speechToText.apiKey"), "");
  assert.equal(secrets.read("plain", "ai.speechToText.yandex.apiKey"), "plain");
  assert.deepEqual(secrets.unreadable, ["ai.speechToText.apiKey"]);
});

// ── Дополнения по ревью D6 (F2, F5, F8) ─────────────────────────────────────

test("в SecretUnreadableError нет ни шифртекста, ни значения секрета", () => {
  const plaintext = "pa55-w0rd-секрет";
  const blob = foreignCiphertext(plaintext);
  const [, iv, tag, body] = blob.split(":");
  // Чужой ключ, оборванный шифртекст, мусор после префикса, испорченный байт
  const stored = [
    blob,
    `v1:${iv}:${tag}`,
    "v1:broken",
    `v1:${iv}:${tag}:${body.slice(0, -2)}AA`,
  ];

  for (const value of stored) {
    let caught;
    try {
      readStoredSecret(value, "mailbox.password");
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof SecretUnreadableError, `не прочитан: ${value}`);

    // Всё, что оператор или человекочитаемый разбор ошибок увидит в журнале
    const visible = [
      caught.message,
      caught.stack,
      String(caught),
      caught.cause?.message,
      caught.cause?.stack,
    ].join("\n");
    for (const secret of [value, plaintext, iv, tag, body]) {
      assert.ok(!visible.includes(secret), `в тексте ошибки есть «${secret}»`);
    }
  }
});

test("ответ «введите заново» без пути не печатает undefined", () => {
  for (const path of [undefined, null, ""]) {
    assert.equal(
      unreadableSecretMessage(path),
      "Сохранённое значение «секрет» не читается — введите его заново",
    );
  }
});

test("нечитаемый секрет как значение: ошибка с причиной, по которой различим потерянный ключ и битый шифртекст", () => {
  const lost = findUnreadableSecret(foreignCiphertext("x"), "mailbox.password");
  assert.ok(lost instanceof SecretUnreadableError);
  assert.equal(lost.path, "mailbox.password");
  assert.match(lost.cause.message, /authenticate/i);

  const corrupt = findUnreadableSecret("v1:broken", "mailbox.password");
  assert.ok(corrupt instanceof SecretUnreadableError);
  assert.equal(corrupt.cause.message, "Malformed encrypted secret");

  // Читается и пусто — не причина отказывать
  assert.equal(findUnreadableSecret(encryptSecret("x"), "mailbox.password"), null);
  assert.equal(findUnreadableSecret("", "mailbox.password"), null);
  assert.equal(findUnreadableSecret(undefined, "mailbox.password"), null);
  assert.equal(findUnreadableSecret("plain-old", "mailbox.password"), null);
});

test("мягкий читатель держит ошибки целиком, а не только пути", () => {
  const secrets = createLenientSecretReader();
  secrets.read(foreignCiphertext("x"), "ai.speechToText.yandex.apiKey");
  secrets.read("v1:broken", "ai.speechToText.apiKey");

  assert.deepEqual(secrets.unreadable, [
    "ai.speechToText.yandex.apiKey",
    "ai.speechToText.apiKey",
  ]);
  assert.ok(secrets.errors.every((error) => error instanceof SecretUnreadableError));
  assert.deepEqual(
    secrets.errors.map((error) => error.path),
    secrets.unreadable,
  );
  assert.equal(secrets.errors[1].cause.message, "Malformed encrypted secret");
});

test("нет или негоден APP_ENC_KEY — ошибка развёртывания, а не «введите заново»", () => {
  // Свой процесс: secretBox кэширует найденный ключ, а здесь нужен момент до него
  const script = `
    const secrets = require(${JSON.stringify(require.resolve("./preferencesSecrets"))});
    const blob = ${JSON.stringify(foreignCiphertext("x"))};
    const probe = (read) => {
      try {
        read();
        return { threw: false };
      } catch (error) {
        return {
          threw: true,
          typed: error instanceof secrets.SecretUnreadableError,
          message: error.message,
        };
      }
    };
    const out = {};
    delete process.env.APP_ENC_KEY;
    delete process.env.MIKROTIK_ENC_KEY;
    out.missing = probe(() => secrets.readStoredSecret(blob, "mailbox.password"));
    out.missingReadable = probe(() => secrets.isSecretReadable(blob, "mailbox.password"));
    out.missingLenient = probe(() =>
      secrets.createLenientSecretReader().read(blob, "mailbox.password"),
    );
    process.env.APP_ENC_KEY = Buffer.from("short").toString("base64");
    out.short = probe(() => secrets.readStoredSecret(blob, "mailbox.password"));
    // Открытый текст и пустое ключа не требуют
    out.plain = secrets.readStoredSecret("plain-old", "mailbox.password");
    out.empty = secrets.readStoredSecret("", "mailbox.password");
    console.log(JSON.stringify(out));
  `;
  const run = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, APP_ENC_KEY: "", MIKROTIK_ENC_KEY: "" },
  });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  const out = JSON.parse(run.stdout);

  for (const name of ["missing", "missingReadable", "missingLenient"]) {
    assert.equal(out[name].threw, true, `${name}: ошибка проглочена`);
    assert.equal(out[name].typed, false, `${name}: ошибка развёртывания названа «введите заново»`);
    assert.match(out[name].message, /^APP_ENC_KEY/);
  }
  assert.equal(out.short.typed, false);
  assert.match(out.short.message, /^APP_ENC_KEY must decode to 32 bytes/);
  assert.equal(out.plain, "plain-old");
  assert.equal(out.empty, "");
});
