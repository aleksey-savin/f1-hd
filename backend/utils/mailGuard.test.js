// node --test utils/mailGuard.test.js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  mailMode,
  assertMailConfig,
  guardRecipient,
  guardSubject,
  describeMailMode,
  mailCanSend,
  MAIL_OFF_FAILURE,
} = require("./mailGuard");

// Окружение каждого теста — своё: режим читается из env при каждом вызове
const KEYS = ["MAIL_MODE", "MAIL_SANDBOX_RECIPIENT", "NODE_ENV", "DEV_MAIL_RECIPIENT"];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("MAIL_MODE не задан: режим off, получателя нет", () => {
  assert.equal(mailMode(), "off");
  assert.equal(guardRecipient("a@b.c"), null);
  assert.equal(guardSubject("Тема", "a@b.c"), "Тема");
  assert.doesNotThrow(() => assertMailConfig());
  assert.deepEqual(describeMailMode(), { mode: "off", sandboxRecipient: null });
});

test("MAIL_MODE=live: получатель и тема не меняются, NODE_ENV не важен", () => {
  process.env.MAIL_MODE = "live";
  for (const nodeEnv of [undefined, "development"]) {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;

    assert.equal(mailMode(), "live");
    assert.equal(guardRecipient("a@b.c"), "a@b.c");
    assert.equal(guardSubject("Тема", "a@b.c"), "Тема");
    assert.doesNotThrow(() => assertMailConfig());
  }
  assert.deepEqual(describeMailMode(), { mode: "live", sandboxRecipient: null });
});

test("MAIL_MODE=sandbox: всё уходит на адрес песочницы, тема помечена", () => {
  process.env.MAIL_MODE = "sandbox";
  process.env.MAIL_SANDBOX_RECIPIENT = "x@example.com";

  assert.equal(mailMode(), "sandbox");
  assert.doesNotThrow(() => assertMailConfig());
  assert.equal(guardRecipient("a@b.c"), "x@example.com");
  assert.ok(guardSubject("Тема", "a@b.c").startsWith("[SANDBOX → a@b.c]"));
  assert.equal(guardSubject("Тема", "a@b.c"), "[SANDBOX → a@b.c] Тема");
  assert.equal(guardSubject("Тема"), "[SANDBOX → ?] Тема");
  // Письмо самому адресу песочницы проходит как есть
  assert.equal(guardRecipient("x@example.com"), "x@example.com");
  assert.deepEqual(describeMailMode(), {
    mode: "sandbox",
    sandboxRecipient: "x@example.com",
  });
});

test("MAIL_MODE=sandbox без адреса: запуск запрещён, письма никуда не уходят", () => {
  process.env.MAIL_MODE = "sandbox";

  assert.throws(() => assertMailConfig(), /MAIL_SANDBOX_RECIPIENT/);
  // Даже если процесс почему-то дожил до отправки — клиенту письмо не уйдёт
  assert.equal(guardRecipient("a@b.c"), null);
});

test("прежняя переменная DEV_MAIL_RECIPIENT больше не читается", () => {
  process.env.MAIL_MODE = "sandbox";
  process.env.DEV_MAIL_RECIPIENT = "old@example.com";

  assert.throws(() => assertMailConfig(), /MAIL_SANDBOX_RECIPIENT/);
  assert.equal(guardRecipient("a@b.c"), null);
});

test("регистр и пробелы в MAIL_MODE не мешают", () => {
  process.env.MAIL_MODE = "LIVE ";
  assert.equal(mailMode(), "live");
  assert.doesNotThrow(() => assertMailConfig());
});

test("неизвестное значение MAIL_MODE: запуск запрещён, режим off", () => {
  process.env.MAIL_MODE = "prod";

  assert.throws(() => assertMailConfig(), /MAIL_MODE/);
  assert.equal(mailMode(), "off");
  assert.equal(guardRecipient("a@b.c"), null);
});

test("NODE_ENV=production без MAIL_MODE — всё равно off", () => {
  process.env.NODE_ENV = "production";

  assert.equal(mailMode(), "off");
  assert.equal(guardRecipient("a@b.c"), null);
});

test("отказ режима off: причина названа, повтор не предлагается", () => {
  assert.equal(MAIL_OFF_FAILURE.state, "Отправка почты выключена на сервере");
  assert.match(MAIL_OFF_FAILURE.hint, /MAIL_MODE=live/);
});

test("mailCanSend: почта включена в настройках и не выключена на сервере", () => {
  const on = { notify: { byEmail: { isActive: true } } };
  const off = { notify: { byEmail: { isActive: false } } };

  // MAIL_MODE не задан — значит off
  assert.equal(mailCanSend(on), false);
  process.env.MAIL_MODE = "off";
  assert.equal(mailCanSend(on), false);

  process.env.MAIL_MODE = "live";
  assert.equal(mailCanSend(on), true);
  assert.equal(mailCanSend(off), false);
  assert.equal(mailCanSend(null), false);
  assert.equal(mailCanSend({}), false);

  // Песочница письма отправляет — путь рабочий
  process.env.MAIL_MODE = "sandbox";
  process.env.MAIL_SANDBOX_RECIPIENT = "box@example.com";
  assert.equal(mailCanSend(on), true);
});
