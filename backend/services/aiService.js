const Preferences = require("@/models/preferences");
const { AppError } = require("@/middleware/errorHandling");
const { readStoredSecret } = require("@/helpers/preferencesSecrets");
const { describeAiError } = require("@/services/aiErrors");
const aiHealth = require("@/services/ai/health");
const logger = require("@/utils/logger");

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// DeepSeek полностью OpenAI-совместим (тот же формат запроса/ответа).
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
// OpenAI-совместимый шлюз Yandex AI Studio — единственный вход к яндексовому
// каталогу (YandexGPT, DeepSeek, Qwen, gpt-oss …) после переименования
// Foundation Models в AI Studio.
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

  // Reasoning models (DeepSeek R1 and kin in the Yandex AI Studio catalogue)
  // put their thinking in <think>…</think> — braces and all, which would derail
  // the outermost-braces fallback below. An unclosed block means the answer was
  // cut off mid-thought: everything from the tag on is reasoning, not JSON.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const openThink = text.search(/<think>/i);
  if (openThink !== -1) {
    text = text.slice(0, openThink).trim();
  }

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
  timeoutMs,
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
      // Локальные серверы моделей ключа не спрашивают, и пустой заголовок часть
      // из них отвергает — тогда не отправляем его вовсе
      ...(apiKey ? { Authorization: `${authScheme} ${apiKey}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    // Без предела висим до победного: неверный адрес в закрытой сети не даёт
    // отказа, пакеты просто пропадают
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
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

// Модель у AI Studio адресуется идентификатором gpt://<каталог>/<модель>/<версия>.
// В настройках храним путь без каталога (иначе смена folder ID протухнет вместе
// с моделью), но принимаем все три вида: целый URI из буфера обмена, «модель/rc»
// из каталога и голое имя из старых конфигураций.
const buildYandexModelUri = (folderId, model) => {
  const value = String(model || "").trim();

  if (value.startsWith("gpt://")) return value;
  if (value.includes("/")) return `gpt://${folderId}/${value}`;

  return `gpt://${folderId}/${value}/latest`;
};

// Yandex AI Studio — OpenAI-совместимый шлюз к яндексовому каталогу.
// Авторизация Api-Key + заголовок x-folder-id; модель — полный modelUri.
const callYandexAi = ({ apiKey, model, folderId, system, user }) => {
  if (!folderId) {
    throw new AppError("Yandex AI Studio folder ID is not set", 400, true);
  }
  // Дефолта нет намеренно: каталог у каждого свой, а угаданное имя даёт 400 с
  // невнятной формулировкой вместо честного «выберите модель».
  if (!String(model || "").trim()) {
    throw new AppError("Yandex AI Studio model is not set", 400, true);
  }

  return callOpenai({
    apiKey,
    model: buildYandexModelUri(folderId, model),
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

// Локально развёрнутая модель: Ollama (порт 11434), LM Studio (1234), vLLM,
// llama.cpp, LocalAI — все отдают OpenAI-совместимый /v1, различаясь только
// адресом. Отсюда один провайдер на всех.
//
// Запрос ограничен по времени: неверный адрес в закрытой сети не отвечает
// отказом, а молча висит — дольше, чем живёт pending у руководства заявки
// (services/ticketAiGuide.js), и карточка успела бы объявить сборку прерванной.
const LOCAL_DEFAULT_PATH = "/v1";
const LOCAL_TIMEOUT_MS = 4 * 60 * 1000;

// Адрес вводит человек, поэтому принимаем все живые написания:
// «192.168.1.10:11434», «http://host:1234/» и «http://host:11434/v1».
// Путь дописываем, только если его нет: за обратным прокси встречается
// http://host/openai/v1, и туда лишний /v1 добавлять нельзя.
const buildLocalBaseUrl = (raw) => {
  const value = String(raw || "").trim();
  if (!value) {
    throw new AppError("Local model base URL is not set", 400, true);
  }

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
  } catch {
    throw new AppError("Local model base URL is malformed", 400, true);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("Local model base URL is malformed", 400, true);
  }

  const path = url.pathname.replace(/\/+$/, "");

  return `${url.origin}${path || LOCAL_DEFAULT_PATH}`;
};

const callLocal = async ({ apiKey, model, baseUrl, system, user }) => {
  if (!String(model || "").trim()) {
    throw new AppError("Local model is not set", 400, true);
  }

  const params = {
    apiKey,
    model,
    system,
    user,
    // Vision у локальных сборок скорее исключение — картинки не шлём
    images: [],
    endpoint: `${buildLocalBaseUrl(baseUrl)}/chat/completions`,
    label: "Локальная модель",
    timeoutMs: LOCAL_TIMEOUT_MS,
  };

  try {
    // Маленькие модели хуже держат формат, поэтому режим JSON здесь нужнее
    // всего — но часть сборок llama.cpp отвечает на него 400
    return await callOpenai({ ...params, jsonMode: true });
  } catch (error) {
    if (error?.statusCode !== 400) throw error;

    logger.log("warn", "Local model rejected json_object, retrying without it", {
      model,
    });

    return callOpenai({ ...params, jsonMode: false });
  }
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
  yandexai: callYandexAi,
  local: callLocal,
};

// Локальный сервер ключа не требует — «ключ не задан» для него не отказ
const needsApiKey = (provider) => provider !== "local";

exports.buildLocalBaseUrl = buildLocalBaseUrl;
exports.needsApiKey = needsApiKey;

// Конфигурация провайдера из группы настроек: ключ в базе лежит шифртекстом
// secretBox, наружу уходит расшифрованный.
const resolveProviderConfig = (ai) => {
  const provider = ai?.provider;
  const providerConfig = provider ? ai[provider] : null;

  return {
    provider,
    apiKey: readStoredSecret(providerConfig?.apiKey),
    model: providerConfig?.model,
    folderId: providerConfig?.folderId,
    baseUrl: providerConfig?.baseUrl,
  };
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

  const { provider, apiKey, model, folderId, baseUrl } =
    resolveProviderConfig(ai);

  if (!apiKey && needsApiKey(provider)) {
    throw new AppError(`API key for ${provider || "AI provider"} is not set`, 400, true);
  }

  const call = PROVIDER_CALLERS[provider];
  if (!call) {
    throw new AppError(`Unsupported AI provider: ${provider}`, 400, true);
  }

  logger.log("info", "Requesting AI completion", { provider, model });

  // Настоящие вызовы и наполняют строку состояния в настройках: разобранный
  // ответ — канал сделал работу, любой отказ по дороге — причина в строке.
  try {
    const raw = await call({
      apiKey,
      model,
      folderId,
      baseUrl,
      system,
      user,
      images,
      maxTokens,
    });
    const data = parseJsonResponse(raw);

    await aiHealth.recordOk(aiHealth.AI, { message: true });

    return { data, provider, model };
  } catch (error) {
    await aiHealth.recordError(aiHealth.AI, describeAiError(error));
    throw error;
  }
};

/**
 * Проба канала «на живом» для кнопки проверки в настройках: минимальная
 * настоящая генерация тем же путём, каким ходят возможности приложения.
 * Принятый ключ — это ещё не работающий канал: неверный идентификатор модели
 * или несговорчивый формат ответа видно только по ответу. Ошибку наружу не
 * бросаем — она и есть результат проверки.
 *
 * Успех пишем в состояние канала, неуспех — нет: проверяют обычно черновик, и
 * красная строка про несохранённые поля врала бы о работающем канале.
 *
 * @returns {Promise<{ ok: boolean, state: string, hint: string }>}
 */
exports.checkProvider = async ({
  provider,
  apiKey,
  model,
  folderId,
  baseUrl,
}) => {
  const call = PROVIDER_CALLERS[provider];

  if (!call) {
    return { ok: false, state: "Поставщик ИИ не выбран", hint: "" };
  }
  if (!apiKey && needsApiKey(provider)) {
    return { ok: false, state: "Ключ поставщика не задан", hint: "" };
  }

  try {
    // Слово «JSON» в промпте обязательно: у OpenAI режим json_object без него
    // отвечает 400. Заодно проба повторяет контракт настоящих вызовов.
    const raw = await call({
      apiKey,
      model,
      folderId,
      baseUrl,
      system: "Ты отвечаешь строго одним JSON-объектом, без пояснений.",
      user: 'Верни JSON: {"ok": true}',
      images: [],
      maxTokens: 64,
    });
    parseJsonResponse(raw);

    await aiHealth.recordOk(aiHealth.AI);

    return { ok: true, state: "Модель отвечает", hint: "" };
  } catch (error) {
    logger.log("warn", "AI provider check failed", {
      provider,
      model,
      error: error.message,
    });

    return { ok: false, ...describeAiError(error) };
  }
};
