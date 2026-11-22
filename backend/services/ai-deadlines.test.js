const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
function service(fetch) {
  const exports = {};
  class AppError extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  const deps = {
    "@/models/preferences": {
      findOne: async () => ({
        ai: {
          isActive: true,
          provider: "openai",
          openai: { apiKey: "test", model: "test" },
        },
      }),
    },
    "@/middleware/errorHandling": { AppError },
    "@/helpers/preferencesSecrets": {
      readStoredSecret: (x) => x,
      SecretUnreadableError: Error,
    },
    "@/services/aiErrors": { describeAiError: (e) => ({ state: e.message }) },
    "@/services/ai/health": {
      recordOk: async () => {},
      recordError: async () => {},
    },
    "@/utils/logger": { log() {} },
  };
  new Function(
    "require",
    "exports",
    "fetch",
    fs.readFileSync(`${__dirname}/aiService.js`, "utf8"),
  )((id) => deps[id] || require(id), exports, fetch);
  return exports;
}
for (const provider of ["openai", "anthropic", "deepseek", "yandexai", "local"])
  test(`${provider} requests have an abort deadline`, async () => {
    const calls = [];
    const ai = service(async (url, options) => {
      calls.push(options);
      return {
        ok: true,
        json: async () =>
          provider === "anthropic"
            ? { content: [{ type: "text", text: '{"ok":true}' }] }
            : { choices: [{ message: { content: '{"ok":true}' } }] },
      };
    });
    await ai.checkProvider({
      provider,
      apiKey: "test",
      model: "test",
      folderId: "test",
      baseUrl: "https://local.example",
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].signal instanceof AbortSignal);
  });
test("local JSON fallback shares the first request deadline", async () => {
  const calls = [];
  const ai = service(async (url, options) => {
    calls.push(options);
    return calls.length === 1
      ? { ok: false, status: 400, text: async () => "unsupported" }
      : {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
        };
  });
  await ai.checkProvider({
    provider: "local",
    model: "test",
    baseUrl: "https://local.example",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal, calls[1].signal);
});

test("generation propagates caller cancellation to the in-flight request", async () => {
  const controller = new AbortController();
  let started;
  const ai = service(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        started = signal;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const pending = ai.generateJson({
    system: "JSON",
    user: "test",
    signal: controller.signal,
  });
  await new Promise(setImmediate);
  controller.abort(new Error("deadline reached"));
  await assert.rejects(pending, /deadline reached/);
  assert.equal(started.aborted, true);
});
