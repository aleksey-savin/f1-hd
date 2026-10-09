// node --test services/speechToTextService.test.js
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

// Модель заявок подменена до загрузки сервиса: models/ticket.js на верхнем
// уровне зовёт initCounter(), и без базы в выводе остаётся «Failed to
// initialize counter» (тот же приём, что в services/ticketAiTerms.test.js).
// Расшифровка читает заявки только в expireStalePendingSpeech, а он здесь не
// нужен.
const ticketModel = require.resolve("@/models/ticket");
const ticketStub = new Module(ticketModel);
ticketStub.filename = ticketModel;
ticketStub.loaded = true;
ticketStub.exports = { Ticket: {} };
require.cache[ticketModel] = ticketStub;

const Preferences = require("@/models/preferences");
const storage = require("@/services/storage");
const logger = require("@/utils/logger");
const { SecretUnreadableError } = require("@/helpers/preferencesSecrets");
const { encryptSecret } = require("@/services/crypto/secretBox");
const { resolveSpeechConfig, transcribeAttachment } = require("./speechToTextService");

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

const dead = foreignCiphertext("dead-key");

// ── Путь ключа в ошибке: имя поля, которое нужно ввести заново ──────────────

const PATHS = [
  {
    name: "OpenAI со своим ключом",
    ai: { provider: "anthropic", speechToText: { provider: "openai", apiKey: dead } },
    path: "ai.speechToText.apiKey",
  },
  {
    // Именно это поле осталось под потерянным ключом 29.09
    name: "Yandex SpeechKit со своим ключом",
    ai: { speechToText: { provider: "yandex", yandex: { apiKey: dead } } },
    path: "ai.speechToText.yandex.apiKey",
  },
  {
    name: "локальный сервер со своим ключом",
    ai: { speechToText: { provider: "local", local: { apiKey: dead } } },
    path: "ai.speechToText.local.apiKey",
  },
  {
    name: "OpenAI с ключом основного провайдера",
    ai: {
      provider: "openai",
      openai: { apiKey: dead },
      speechToText: { provider: "openai", useProviderCredentials: true },
    },
    path: "ai.openai.apiKey",
  },
  {
    name: "Yandex SpeechKit с ключом Yandex AI Studio",
    ai: {
      provider: "yandexai",
      yandexai: { apiKey: dead },
      speechToText: { provider: "yandex", useProviderCredentials: true },
    },
    path: "ai.yandexai.apiKey",
  },
  {
    name: "локальный сервер с ключом основного провайдера",
    ai: {
      provider: "local",
      local: { apiKey: dead },
      speechToText: { provider: "local", useProviderCredentials: true },
    },
    path: "ai.local.apiKey",
  },
];

for (const { name, ai, path } of PATHS) {
  test(`строгий читатель: ${name} — SecretUnreadableError с путём ${path}`, () => {
    assert.throws(
      () => resolveSpeechConfig(ai),
      (error) => {
        assert.ok(error instanceof SecretUnreadableError);
        assert.equal(error.path, path);
        return true;
      },
    );
  });

  test(`читателю передаётся тот же путь: ${name}`, () => {
    const seen = [];
    const config = resolveSpeechConfig(ai, (stored, readPath) => {
      seen.push([stored, readPath]);
      return "plain-key";
    });

    assert.deepEqual(seen, [[dead, path]]);
    assert.equal(config.apiKey, "plain-key");
  });
}

test("строгий читатель: читаемый ключ расшифровывается, пустой остаётся пустым", () => {
  const readable = {
    speechToText: { provider: "yandex", yandex: { apiKey: encryptSecret("sk-yandex") } },
  };
  assert.equal(resolveSpeechConfig(readable).apiKey, "sk-yandex");
  assert.equal(
    resolveSpeechConfig({ speechToText: { provider: "yandex", yandex: { apiKey: "" } } })
      .apiKey,
    "",
  );
});

// ── Рабочий путь: как расшифровка читает ключ (F3) ──────────────────────────

const storedSpeech = (t, ai) => {
  t.mock.method(Preferences, "findOne", async () => ({ ai }));
  t.mock.method(Preferences, "updateOne", async () => ({ acknowledged: true }));
  t.mock.method(storage, "getObjectBuffer", async () => Buffer.from("audio"));
};

// Поставщик «молчит»: дальше запроса конвейер не идёт, а сам запрос записан
const stubFetch = (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    throw new Error("стоп: дальше запроса конвейер не нужен");
  });
  return calls;
};

const silenceLog = (t) => t.mock.method(logger, "log", () => {});

const call = { name: "call.mp3" };

test("локальный сервер распознавания: нечитаемый необязательный ключ — запрос без Authorization", async (t) => {
  storedSpeech(t, {
    isActive: true,
    provider: "anthropic",
    speechToText: {
      isActive: true,
      provider: "local",
      local: { baseUrl: "http://whisper.example.ru:8000", model: "large-v3", apiKey: dead },
    },
  });
  silenceLog(t);
  const calls = stubFetch(t);

  await assert.rejects(transcribeAttachment(call), { message: /стоп/ });

  assert.equal(calls.length, 1, "запрос к серверу распознавания не ушёл");
  assert.match(calls[0].url, /whisper\.example\.ru:8000/);
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("локальный сервер распознавания с ключом основного провайдера: нечитаемый ключ — запрос без Authorization", async (t) => {
  storedSpeech(t, {
    isActive: true,
    provider: "local",
    local: { baseUrl: "http://ollama.example.ru:11434", model: "llama3", apiKey: dead },
    speechToText: {
      isActive: true,
      provider: "local",
      useProviderCredentials: true,
      local: { model: "large-v3" },
    },
  });
  silenceLog(t);
  const calls = stubFetch(t);

  await assert.rejects(transcribeAttachment(call), { message: /стоп/ });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("читаемый ключ локального сервера уходит заголовком", async (t) => {
  storedSpeech(t, {
    isActive: true,
    speechToText: {
      isActive: true,
      provider: "local",
      local: {
        baseUrl: "http://whisper.example.ru:8000",
        model: "large-v3",
        apiKey: encryptSecret("proxy-key"),
      },
    },
  });
  silenceLog(t);
  const calls = stubFetch(t);

  await assert.rejects(transcribeAttachment(call), { message: /стоп/ });

  assert.equal(calls[0].options.headers.Authorization, "Bearer proxy-key");
});

for (const { name, ai, path } of PATHS.filter(({ ai }) => ai.speechToText.provider !== "local")) {
  test(`обязательный ключ не читается: расшифровка называет поле и не обращается к поставщику — ${name}`, async (t) => {
    storedSpeech(t, {
      isActive: true,
      ...ai,
      speechToText: {
        isActive: true,
        ...ai.speechToText,
        yandex: { folderId: "b1g00000000000000000", ...ai.speechToText.yandex },
      },
    });
    silenceLog(t);
    const calls = stubFetch(t);

    await assert.rejects(transcribeAttachment(call), (error) => {
      assert.ok(error instanceof SecretUnreadableError, String(error));
      assert.equal(error.path, path);
      return true;
    });
    assert.equal(calls.length, 0);
  });
}
