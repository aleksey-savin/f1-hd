// node --test services/aiService.test.js
require("module-alias/register");
const crypto = require("node:crypto");

// Ключ шифрования теста — до первого обращения к secretBox (он кэширует ключ)
process.env.APP_ENC_KEY = crypto.randomBytes(32).toString("base64");

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Обращение к базе мимо подменённых методов падает сразу, а не висит десять
// секунд в ожидании подключения
mongoose.set("bufferCommands", false);

const Preferences = require("@/models/preferences");
const logger = require("@/utils/logger");
const { SecretUnreadableError } = require("@/helpers/preferencesSecrets");
const { encryptSecret } = require("@/services/crypto/secretBox");
const { generateJson } = require("./aiService");

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

// Настройки «из базы»; запись состояния канала ИИ уходит в никуда. Возвращает
// подмену findOne: через mock.mockImplementation настройки меняют на ходу
const storedAi = (t, ai) => {
  t.mock.method(Preferences, "updateOne", async () => ({ acknowledged: true }));
  return t.mock.method(Preferences, "findOne", async () => ({ ai }));
};

// Поставщик отвечает разобранным JSON; вызовы записываются
const stubFetch = (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok": true}' } }] }),
      text: async () => "",
    };
  });
  return calls;
};

const captureLog = (t) => {
  const entries = [];
  t.mock.method(logger, "log", (level, message, meta) => {
    entries.push({ level, message, meta });
  });
  return entries;
};

const localAi = (apiKey) => ({
  isActive: true,
  provider: "local",
  local: { baseUrl: "http://ollama.example.ru:11434", model: "llama3", apiKey },
});

// ── Обязательные ключи ──────────────────────────────────────────────────────

for (const provider of ["openai", "anthropic", "deepseek", "yandexai"]) {
  test(`${provider}: ключ не читается — ошибка называет поле, запрос поставщику не уходит`, async (t) => {
    storedAi(t, {
      isActive: true,
      provider,
      [provider]: {
        apiKey: foreignCiphertext("sk-chat"),
        model: "some-model",
        folderId: "b1g00000000000000000",
      },
    });
    const calls = stubFetch(t);

    await assert.rejects(generateJson({ system: "s", user: "u" }), (error) => {
      assert.ok(error instanceof SecretUnreadableError);
      // По пути журнал и разбор ошибок узнают, какой ключ вводить заново
      assert.equal(error.path, `ai.${provider}.apiKey`);
      return true;
    });
    assert.equal(calls.length, 0, "с нечитаемым ключом к поставщику обратились");
  });
}

// ── Необязательный ключ локальной модели (F3) ───────────────────────────────

test("локальная модель: нечитаемый необязательный ключ — запрос уходит без Authorization", async (t) => {
  storedAi(t, localAi(foreignCiphertext("proxy-key")));
  captureLog(t);
  const calls = stubFetch(t);

  const result = await generateJson({ system: "s", user: "u" });

  assert.deepEqual(result.data, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("локальная модель: читаемый ключ по-прежнему уходит заголовком", async (t) => {
  storedAi(t, localAi(encryptSecret("proxy-key")));
  const calls = stubFetch(t);

  await generateJson({ system: "s", user: "u" });

  assert.equal(calls[0].options.headers.Authorization, "Bearer proxy-key");
});

test("локальная модель: о нечитаемом ключе — одна строка журнала на значение, без шифртекста", async (t) => {
  const blob = foreignCiphertext("proxy-key");
  const findOne = storedAi(t, localAi(blob));
  const log = captureLog(t);
  stubFetch(t);

  // Вызовы идут непрерывно, причина одна: строка не должна повторяться
  await generateJson({ system: "s", user: "u" });
  await generateJson({ system: "s", user: "u" });
  await generateJson({ system: "s", user: "u" });

  const warns = log.filter((entry) => entry.level === "warn");
  assert.equal(warns.length, 1);
  assert.match(JSON.stringify(warns[0]), /ai\.local\.apiKey/);
  assert.ok(!JSON.stringify(log).includes(blob), "в журнале шифртекст");

  // Новое нечитаемое значение — новая строка: ключ перезаписали, и он снова мёртв
  findOne.mock.mockImplementation(async () => ({
    ai: localAi(foreignCiphertext("another-key")),
  }));
  await generateJson({ system: "s", user: "u" });
  assert.equal(log.filter((entry) => entry.level === "warn").length, 2);
});

test("нет APP_ENC_KEY: необязательный ключ не прячет ошибку развёртывания", () => {
  // Свой процесс: secretBox кэширует найденный ключ, а здесь нужен момент до него
  const script = `
    require("module-alias/register");
    const { readOptionalKey } = require("@/services/aiService");
    const blob = ${JSON.stringify(foreignCiphertext("x"))};
    try {
      console.log("RESULT " + JSON.stringify({ returned: readOptionalKey(blob, "ai.local.apiKey") }));
    } catch (error) {
      console.log("RESULT " + JSON.stringify({ threw: error.name, message: error.message }));
    }
  `;
  const run = spawnSync(process.execPath, ["-e", script], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, APP_ENC_KEY: "", MIKROTIK_ENC_KEY: "" },
  });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  const out = JSON.parse(run.stdout.split("\n").find((line) => line.startsWith("RESULT ")).slice(7));

  // «Как будто ключа нет» годится для нечитаемого значения, но не для сервера
  // без ключа шифрования: там сломан сам запуск
  assert.equal(out.returned, undefined, "ошибка развёртывания проглочена");
  assert.equal(out.threw, "Error");
  assert.match(out.message, /^APP_ENC_KEY/);
});
