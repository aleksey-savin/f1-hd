const Preferences = require("@/models/preferences");
const { AppError } = require("@/middleware/errorHandling");
const logger = require("@/utils/logger");

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// DeepSeek полностью OpenAI-совместим (тот же формат запроса/ответа).
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const YANDEX_GPT_ENDPOINT =
  "https://llm.api.cloud.yandex.net/foundationModels/v1/completion";
// OpenAI-совместимый шлюз Yandex AI Studio (open-source каталог: DeepSeek, Qwen …).
const YANDEX_AI_STUDIO_ENDPOINT =
  "https://llm.api.cloud.yandex.net/v1/chat/completions";

/**
 * Pull a JSON object out of a model response that may be wrapped in prose or
 * ```json fences.
 */
const parseJsonResponse = (raw) => {
  if (!raw || typeof raw !== "string") {
    throw new AppError("AI returned an empty response", 502, true);
  }

  let text = raw.trim();

  // Strip ```json ... ``` / ``` ... ``` fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  }

  // Fall back to the outermost braces.
  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      text = text.slice(first, last + 1);
    }
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError(
      "Failed to parse AI JSON response",
      502,
      true,
      error,
      { raw },
    );
  }
};

const callOpenai = async ({
  apiKey,
  model,
  system,
  user,
  images = [],
  endpoint = OPENAI_ENDPOINT,
  label = "OpenAI",
  authScheme = "Bearer",
  extraHeaders = {},
  jsonMode = true,
}) => {
  const content = images.length
    ? [
        { type: "text", text: user },
        ...images.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mediaType};base64,${img.data}` },
        })),
      ]
    : user;

  // Не задаём temperature (новые модели GPT-5/o-серии принимают только дефолт).
  // Лимит вывода не передаём: у reasoning-моделей (GPT-5/o-серии) даже валидный
  // max_completion_tokens уходит в бюджет рассуждений и приводит к отклонению
  // запроса (400) либо пустому ответу. Дефолтного лимита модели хватает для
  // JSON-ответа (так же работает вызов AI-guide, который лимит не задаёт).
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
  };
  // У части OpenAI-совместимых провайдеров (Yandex AI Studio) response_format не
  // поддерживается — полагаемся на промпт и терпимый parseJsonResponse.
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${authScheme} ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new AppError(
      `${label} request failed (${response.status}): ${detail}`,
      response.status,
      true,
      null,
      { detail },
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content;
};

// DeepSeek использует OpenAI-совместимый протокол. Vision не поддерживается —
// изображения не передаём.
const callDeepseek = (params) =>
  callOpenai({
    ...params,
    images: [],
    endpoint: DEEPSEEK_ENDPOINT,
    label: "DeepSeek",
  });

// Yandex AI Studio — OpenAI-совместимый шлюз к open-source каталогу (DeepSeek,
// Qwen …). Авторизация Api-Key + заголовок x-folder-id; модель — полный modelUri.
const callYandexAi = ({ apiKey, model, folderId, system, user }) => {
  if (!folderId) {
    throw new AppError("Yandex AI Studio folder ID is not set", 400, true);
  }

  return callOpenai({
    apiKey,
    model: `gpt://${folderId}/${model || "deepseek-r1"}/latest`,
    system,
    user,
    images: [],
    endpoint: YANDEX_AI_STUDIO_ENDPOINT,
    label: "Yandex AI Studio",
    authScheme: "Api-Key",
    extraHeaders: { "x-folder-id": folderId },
    jsonMode: false,
  });
};

const callYandexGpt = async ({
  apiKey,
  model,
  folderId,
  system,
  user,
  maxTokens,
}) => {
  if (!folderId) {
    throw new AppError("Yandex GPT folder ID is not set", 400, true);
  }

  const modelUri = `gpt://${folderId}/${model || "yandexgpt"}/latest`;

  const response = await fetch(YANDEX_GPT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${apiKey}`,
      "x-folder-id": folderId,
    },
    body: JSON.stringify({
      modelUri,
      completionOptions: {
        stream: false,
        temperature: 0.3,
        maxTokens: String(maxTokens || 2000),
      },
      messages: [
        { role: "system", text: system },
        { role: "user", text: user },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new AppError(
      `Yandex GPT request failed (${response.status})`,
      response.status,
      true,
      null,
      { detail },
    );
  }

  const data = await response.json();
  return data.result?.alternatives?.[0]?.message?.text;
};

const callAnthropic = async ({
  apiKey,
  model,
  system,
  user,
  images,
  maxTokens,
}) => {
  const content = images.length
    ? [
        { type: "text", text: user },
        ...images.map((img) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mediaType,
            data: img.data,
          },
        })),
      ]
    : user;

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 1500,
      system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new AppError(
      `Anthropic request failed (${response.status})`,
      response.status,
      true,
      null,
      { detail },
    );
  }

  const data = await response.json();
  return data.content?.[0]?.text;
};

// Диспетчер реализаций по провайдеру.
const PROVIDER_CALLERS = {
  openai: callOpenai,
  anthropic: callAnthropic,
  deepseek: callDeepseek,
  yandexgpt: callYandexGpt,
  yandexai: callYandexAi,
};

/**
 * Provider-agnostic helper that asks the configured AI provider for a single
 * JSON object. Reads provider/key/model from the singleton Preferences doc.
 *
 * @param {object[]} [params.images] optional vision inputs: { mediaType, data (base64) }
 * @param {number} [params.maxTokens] optional output cap (Anthropic default 1500);
 *   raise it for larger JSON payloads (e.g. a full cleaned call dialog) to avoid
 *   truncation that would make the response invalid JSON.
 * @param {boolean} [params.requireActive=true] when false, only a configured
 *   provider key is required — the global `ai.isActive` (AI-guide) master switch is
 *   not enforced. Used by speech summaries, which have their own feature toggle.
 * @returns {Promise<{ data: object, provider: string, model: string }>}
 */
exports.generateJson = async ({
  system,
  user,
  images = [],
  maxTokens,
  requireActive = true,
}) => {
  const preferences = await Preferences.findOne({});
  const ai = preferences?.ai;

  if (requireActive && !ai?.isActive) {
    throw new AppError("AI features are disabled", 400, true);
  }

  const provider = ai?.provider;
  const providerConfig = provider ? ai[provider] : null;
  const apiKey = providerConfig?.apiKey;
  const model = providerConfig?.model;
  const folderId = providerConfig?.folderId;

  if (!apiKey) {
    throw new AppError(`API key for ${provider || "AI provider"} is not set`, 400, true);
  }

  const call = PROVIDER_CALLERS[provider];
  if (!call) {
    throw new AppError(`Unsupported AI provider: ${provider}`, 400, true);
  }

  logger.log("info", "Requesting AI completion", { provider, model });

  const raw = await call({
    apiKey,
    model,
    folderId,
    system,
    user,
    images,
    maxTokens,
  });

  return { data: parseJsonResponse(raw), provider, model };
};
