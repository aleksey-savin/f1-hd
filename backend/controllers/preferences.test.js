// node --test controllers/preferences.test.js
require("module-alias/register");
const crypto = require("node:crypto");
const Module = require("node:module");

// Ключ шифрования теста — до первого обращения к secretBox (он кэширует ключ)
process.env.APP_ENC_KEY = crypto.randomBytes(32).toString("base64");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Обращение к базе мимо подменённых методов падает сразу, а не висит десять
// секунд в ожидании подключения
mongoose.set("bufferCommands", false);

/**
 * Модель заявок подменена в require.cache до загрузки контроллера:
 * models/ticket.js на верхнем уровне зовёт initCounter(), и без базы в выводе
 * остаётся «Failed to initialize counter» (тот же приём, что в
 * controllers/company.access.test.js; одного bufferCommands мало — он лишь
 * заставляет initCounter упасть сразу, а не через десять секунд). Настроек
 * заявки не касаются.
 */
const stubModule = (path, exportsValue) => {
  const resolved = require.resolve(path);
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exportsValue;
  require.cache[resolved] = stub;
};
stubModule("@/models/ticket", { Ticket: {} });

const Preferences = require("../models/preferences");
const { encryptSecret } = require("../services/crypto/secretBox");
const { SecretUnreadableError } = require("../helpers/preferencesSecrets");
const logger = require("../utils/logger");
const { update, checkAi, getAiModels, checkMailbox, sendTestEmail } = require("./preferences");

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

// Документ настроек «из базы»; сохранение подменено и считается
const storedPreferences = (t, fields) => {
  const doc = new Preferences(fields);
  const saves = [];
  t.mock.method(doc, "save", async () => {
    saves.push(doc.toObject());
    return doc;
  });
  t.mock.method(Preferences, "findOne", async () => doc);
  return saves;
};

const callHandler = async (handler, req) => {
  let passed;
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  await handler({ auth: { user: { _id: "u1" } }, ...req }, res, (error) => {
    passed = error;
  });
  return { res, error: passed };
};

const callUpdate = (body) => callHandler(update, { body });

// Текст ответа «введите заново» для подписи поля на экране настроек
const reenter = (label) =>
  `Сохранённое значение «${label}» не читается — введите его заново`;

const activeMailbox = (password) => ({
  isActive: true,
  address: "support@example.ru",
  host: "imap.example.ru",
  port: 993,
  password,
});

const defaultApplicant = {
  _id: new mongoose.Types.ObjectId(),
  firstName: "Служба",
  lastName: "Поддержки",
};

test("пароль ящика под чужим ключом — 422 с названием поля, без сохранения", async (t) => {
  const saves = storedPreferences(t, {
    mailbox: activeMailbox(foreignCiphertext("imap-pass")),
    defaultApplicant,
  });

  const { error } = await callUpdate({ timezone: "Asia/Vladivostok" });

  assert.equal(error.statusCode, 422);
  assert.equal(
    error.message,
    "Сохранённое значение «Пароль почтового ящика» не читается — введите его заново",
  );
  assert.equal(saves.length, 0);
});

test("пароль, введённый заново, снимает блокировку", async (t) => {
  const saves = storedPreferences(t, {
    mailbox: activeMailbox(foreignCiphertext("old-pass")),
    defaultApplicant,
  });

  const { res, error } = await callUpdate({ mailbox: { password: "новый пароль" } });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(saves.length, 1);
});

test("пароль SMTP под чужим ключом — 422", async (t) => {
  storedPreferences(t, {
    notify: {
      byEmail: {
        isActive: true,
        host: "smtp.example.ru",
        port: 465,
        sendFromEmail: "hd@example.ru",
        user: "hd",
        pass: foreignCiphertext("smtp-pass"),
      },
    },
  });

  const { error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error.statusCode, 422);
  assert.equal(
    error.message,
    "Сохранённое значение «Пароль SMTP» не читается — введите его заново",
  );
});

test("ключ распознавания речи под чужим ключом — 422 вместо прежних 500", async (t) => {
  storedPreferences(t, {
    ai: {
      isActive: true,
      provider: "openai",
      openai: { apiKey: encryptSecret("sk-chat"), model: "gpt-4o" },
      speechToText: {
        isActive: true,
        provider: "openai",
        apiKey: foreignCiphertext("sk-speech"),
      },
    },
  });

  const { error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error.statusCode, 422);
  assert.equal(
    error.message,
    "Сохранённое значение «API-ключ OpenAI для распознавания речи» не читается — введите его заново",
  );
});

test("ключ чат-провайдера под чужим ключом — 422 с его названием", async (t) => {
  storedPreferences(t, {
    ai: {
      isActive: true,
      provider: "anthropic",
      anthropic: { apiKey: foreignCiphertext("sk-ant"), model: "claude-opus-4-8" },
    },
  });

  const { error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error.statusCode, 422);
  assert.equal(
    error.message,
    "Сохранённое значение «API-ключ Anthropic» не читается — введите его заново",
  );
});

test("необязательный ключ локальной модели сохранению не мешает", async (t) => {
  const saves = storedPreferences(t, {
    ai: {
      isActive: true,
      provider: "local",
      local: {
        baseUrl: "http://ollama.example.ru:11434",
        apiKey: foreignCiphertext("proxy-key"),
        model: "llama3",
      },
    },
  });

  const { res, error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(saves.length, 1);
});

// ── Дополнения по ревью D6 (F2, F6, F8) ─────────────────────────────────────

// Каждое поле, чей нечитаемый шифртекст останавливает сохранение: названия
// подписей и путей — как на экране настроек и в SECRET_PATHS
const BLOCKING_SECRETS = [
  {
    name: "пароль почтового ящика",
    path: "mailbox.password",
    label: "Пароль почтового ящика",
    fields: (blob) => ({ mailbox: activeMailbox(blob), defaultApplicant }),
  },
  {
    name: "пароль SMTP",
    path: "notify.byEmail.pass",
    label: "Пароль SMTP",
    fields: (blob) => ({
      notify: {
        byEmail: {
          isActive: true,
          host: "smtp.example.ru",
          port: 465,
          sendFromEmail: "hd@example.ru",
          user: "hd",
          pass: blob,
        },
      },
    }),
  },
  {
    name: "ключ чат-провайдера",
    path: "ai.anthropic.apiKey",
    label: "API-ключ Anthropic",
    fields: (blob) => ({
      ai: {
        isActive: true,
        provider: "anthropic",
        anthropic: { apiKey: blob, model: "claude-opus-4-8" },
      },
    }),
  },
  {
    name: "ключ распознавания речи OpenAI",
    path: "ai.speechToText.apiKey",
    label: "API-ключ OpenAI для распознавания речи",
    fields: (blob) => ({
      ai: {
        isActive: true,
        provider: "openai",
        openai: { apiKey: encryptSecret("sk-chat"), model: "gpt-4o" },
        speechToText: { isActive: true, provider: "openai", apiKey: blob },
      },
    }),
  },
  {
    // Именно это поле осталось под потерянным ключом 29.09
    name: "ключ Yandex SpeechKit",
    path: "ai.speechToText.yandex.apiKey",
    label: "API-ключ Yandex SpeechKit",
    fields: (blob) => ({
      ai: {
        isActive: true,
        provider: "openai",
        openai: { apiKey: encryptSecret("sk-chat"), model: "gpt-4o" },
        speechToText: {
          isActive: true,
          provider: "yandex",
          yandex: { apiKey: blob, folderId: "b1g00000000000000000" },
        },
      },
    }),
  },
];

test("страховка: нечитаемый секрет на пути к save — тот же 422, без шифртекста и без ответа 200", async (t) => {
  const plaintext = "imap-pass";
  const blob = foreignCiphertext(plaintext);
  const cause = new Error("Unsupported state or unable to authenticate data");
  const doc = new Preferences({});
  t.mock.method(doc, "save", async () => {
    throw new SecretUnreadableError("mailbox.password", cause);
  });
  t.mock.method(Preferences, "findOne", async () => doc);

  const { res, error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error.statusCode, 422, "не 422");
  assert.equal(error.message, reenter("Пароль почтового ящика"));
  assert.equal(res.body, undefined, "на сохранение, которого не было, ответили успехом");
  // Причина расшифровки едет рядом: по ней в журнале различают потерянный
  // ключ и битый шифртекст
  assert.ok(error.originalError instanceof SecretUnreadableError);
  assert.equal(error.originalError.cause, cause);
  const visible = [error.message, error.originalError.message, error.originalError.stack];
  for (const secret of [blob, plaintext]) {
    assert.ok(!visible.join("\n").includes(secret), `в ответе или журнале есть «${secret}»`);
  }
});

test("страховка без пути в ошибке не печатает undefined", async (t) => {
  const doc = new Preferences({});
  t.mock.method(doc, "save", async () => {
    throw new SecretUnreadableError(undefined, new Error("x"));
  });
  t.mock.method(Preferences, "findOne", async () => doc);

  const { error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error.statusCode, 422);
  assert.equal(error.message, reenter("секрет"));
});

test("любая другая ошибка на пути к save — 500 с исходной причиной, а не 422", async (t) => {
  const doc = new Preferences({});
  const failure = new Error("APP_ENC_KEY (or MIKROTIK_ENC_KEY) is not set");
  t.mock.method(doc, "save", async () => {
    throw failure;
  });
  t.mock.method(Preferences, "findOne", async () => doc);

  const { error } = await callUpdate({ timezone: "Europe/Moscow" });

  // Ключа шифрования нет — это ошибка развёртывания: «введите заново» не
  // поможет, а в журнале должна остаться сама причина
  assert.equal(error.statusCode, 500);
  assert.equal(error.message, "Failed to update preferences");
  assert.equal(error.originalError, failure);
});

for (const { name, path, label, fields } of BLOCKING_SECRETS) {
  test(`${name} под чужим ключом: 422 с названием поля, причиной в журнале и без шифртекста`, async (t) => {
    const blob = foreignCiphertext("secret-value");
    const saves = storedPreferences(t, fields(blob));

    const { res, error } = await callUpdate({ timezone: "Europe/Moscow" });

    assert.equal(error.statusCode, 422);
    assert.equal(error.message, reenter(label));
    assert.equal(saves.length, 0, "настройки сохранены вопреки 422");
    assert.equal(res.body, undefined);
    // Инвариант отдаёт ошибку расшифровки вместе с отказом
    assert.ok(error.originalError instanceof SecretUnreadableError);
    assert.equal(error.originalError.path, path);
    assert.match(error.originalError.cause.message, /authenticate/i);
    const visible = [error.message, error.originalError.message, error.originalError.stack];
    assert.ok(!visible.join("\n").includes(blob), "в ответе или журнале шифртекст");
  });
}

test("битый шифртекст отличим от потерянного ключа по причине в журнале", async (t) => {
  storedPreferences(t, {
    mailbox: activeMailbox("v1:broken"),
    defaultApplicant,
  });

  const { error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error.statusCode, 422);
  assert.equal(error.originalError.cause.message, "Malformed encrypted secret");
});

test("распознавание на локальном сервере: нечитаемый необязательный ключ сохранению не мешает", async (t) => {
  const saves = storedPreferences(t, {
    ai: {
      isActive: true,
      provider: "openai",
      openai: { apiKey: encryptSecret("sk-chat"), model: "gpt-4o" },
      speechToText: {
        isActive: true,
        provider: "local",
        local: {
          baseUrl: "http://whisper.example.ru:8000",
          model: "large-v3",
          apiKey: foreignCiphertext("proxy-key"),
        },
      },
    },
  });

  const { res, error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(saves.length, 1);
});

test("SMTP без авторизации: нечитаемый пароль сохранению не мешает", async (t) => {
  const saves = storedPreferences(t, {
    notify: {
      byEmail: {
        isActive: true,
        authMethod: "none",
        host: "relay.example.ru",
        port: 25,
        security: "none",
        sendFromEmail: "hd@example.ru",
        pass: foreignCiphertext("old-smtp-pass"),
      },
    },
  });

  const { res, error } = await callUpdate({ timezone: "Europe/Moscow" });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(saves.length, 1);
});

// F6: проверки и список моделей по-прежнему отвечают 500 (ответ 422 им нужен
// вместе с правкой интерфейса), но журнал обязан называть поле
const CHECKS = [
  {
    name: "checkAi",
    handler: checkAi,
    req: { body: {} },
    path: "ai.openai.apiKey",
    fields: (blob) => ({
      ai: { provider: "openai", openai: { apiKey: blob, model: "gpt-4o" } },
    }),
    message: "Failed to check AI provider",
  },
  {
    name: "getAiModels, чат",
    handler: getAiModels,
    req: { body: { provider: "anthropic" } },
    path: "ai.anthropic.apiKey",
    fields: (blob) => ({
      ai: { provider: "anthropic", anthropic: { apiKey: blob } },
    }),
    message: "Failed to fetch AI models",
  },
  {
    name: "getAiModels, распознавание со своим ключом",
    handler: getAiModels,
    req: { body: { provider: "openai", feature: "speechToText" } },
    path: "ai.speechToText.apiKey",
    fields: (blob) => ({
      ai: { provider: "anthropic", speechToText: { provider: "openai", apiKey: blob } },
    }),
    message: "Failed to fetch AI models",
  },
  {
    name: "getAiModels, распознавание на локальном сервере",
    handler: getAiModels,
    req: { body: { provider: "local", feature: "speechToText" } },
    path: "ai.speechToText.local.apiKey",
    fields: (blob) => ({
      ai: {
        provider: "anthropic",
        speechToText: { provider: "local", local: { apiKey: blob } },
      },
    }),
    message: "Failed to fetch AI models",
  },
  {
    name: "getAiModels, распознавание с ключом основного провайдера",
    handler: getAiModels,
    req: { body: { provider: "openai", feature: "speechToText" } },
    path: "ai.openai.apiKey",
    fields: (blob) => ({
      ai: {
        provider: "openai",
        openai: { apiKey: blob },
        speechToText: { provider: "openai", useProviderCredentials: true },
      },
    }),
    message: "Failed to fetch AI models",
  },
];

for (const { name, handler, req, path, fields, message } of CHECKS) {
  test(`${name}: журнал называет нечитаемое поле`, async (t) => {
    storedPreferences(t, fields(foreignCiphertext("secret-value")));

    const { error } = await callHandler(handler, req);

    assert.equal(error.statusCode, 500);
    assert.equal(error.message, message);
    assert.ok(error.originalError instanceof SecretUnreadableError);
    assert.equal(error.originalError.path, path);
  });
}

// Две почтовые проверки — не как проверки ИИ выше: экран уже показывает отказ почтовой
// проверки из ответа 200 ({ ok: false, state, hint }), поэтому нечитаемый пароль
// называется там же, а не сводится к ответу 500 и безликому «Не удалось выполнить
// проверку». Форма секретов не присылает: пустое поле берёт сохранённое значение.
test("проверка ящика: пароль под чужим ключом — 200 с причиной «введите заново», а не 500", async (t) => {
  t.mock.method(logger, "log", () => {});
  storedPreferences(t, {
    mailbox: activeMailbox(foreignCiphertext("imap-pass")),
    defaultApplicant,
  });

  const { res, error } = await callHandler(checkMailbox, {
    body: { mailbox: { address: "support@example.ru", host: "imap.example.ru", port: 993 } },
  });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.state, reenter("Пароль почтового ящика"));
  assert.ok(res.body.hint, "подсказка пуста");
});

test("тестовое письмо: пароль SMTP под чужим ключом — 200 с причиной «введите заново», а не 500", async (t) => {
  t.mock.method(logger, "log", () => {});
  storedPreferences(t, {
    notify: {
      byEmail: {
        isActive: true,
        host: "smtp.example.ru",
        port: 465,
        sendFromEmail: "hd@example.ru",
        user: "hd",
        pass: foreignCiphertext("smtp-pass"),
      },
    },
  });

  const { res, error } = await callHandler(sendTestEmail, {
    auth: { legacy: { email: "admin@example.ru" } },
    body: { byEmail: { host: "smtp.example.ru", port: 465, user: "hd", sendFromEmail: "hd@example.ru" } },
  });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.state, reenter("Пароль SMTP"));
  assert.ok(res.body.hint, "подсказка пуста");
});
