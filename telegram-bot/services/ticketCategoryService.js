const axios = require("axios");

const { Ticket } = require("../models/ticket");
const TicketCategory = require("../models/ticketCategory");
const Preferences = require("../models/preferences");
const TicketLog = require("../models/ticketLog");
const AiFeedback = require("../models/aiFeedback");
const { isEncrypted, decryptSecret } = require("./crypto/secretBox");
const logger = require("../utils/logger");

// Самодостаточное зеркало backend/services/ticketCategoryService.js (+ aiService,
// prompts/ticketCategory). telegram-bot — отдельный сервис со своими моделями и без
// общего кода с backend, поэтому логика автоопределения категории продублирована
// здесь. При изменении промпта/логики в backend синхронизируйте этот файл.

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// DeepSeek OpenAI-совместим; Yandex AI Studio — единственный вход к яндексовому
// каталогу (YandexGPT, DeepSeek, Qwen …).
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const YANDEX_AI_STUDIO_ENDPOINT =
  "https://llm.api.cloud.yandex.net/v1/chat/completions";

const MAX_FIELD_LENGTH = 2000;
const MAX_CATEGORY_DESCRIPTION_LENGTH = 600;

const AI_USER = { firstName: "ИИ", lastName: "" };

const stripHtml = (value) => {
  if (!value) return "";
  return value
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const truncate = (value, max = MAX_FIELD_LENGTH) => {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

// Системный/пользовательский промпт классификатора (зеркало backend prompts/ticketCategory.js).
const buildCategoryPrompt = ({
  title = "",
  description = "",
  categories = [],
}) => {
  const system = [
    "Ты — классификатор обращений в техническую поддержку.",
    "Тебе передают заявку (тема, описание) и список категорий-кандидатов, у каждой — id, название и описание.",
    "Выбери ОДНУ категорию, которая лучше всего подходит к заявке, опираясь прежде всего на ОПИСАНИЕ категории (description), а название используй как подсказку.",
    "Если ни одна категория не подходит уверенно — верни categoryId со значением null. Не угадывай и не выдумывай категории вне списка.",
    "Также всегда возвращай closest — массив id до 3 наиболее близких по смыслу категорий, отсортированных по убыванию релевантности. Если categoryId определён — это следующие по близости варианты; если categoryId = null — самые близкие из возможных (чтобы человек мог выбрать вручную).",
    "Отвечай СТРОГО в формате JSON без какого-либо текста вокруг:",
    '{ "categoryId": "<id выбранной категории или null>", "closest": ["<id>", "<id>", "<id>"], "reason": "краткое обоснование на русском" }',
    "categoryId и все значения closest должны быть только из id переданных категорий (categoryId может быть null).",
  ].join("\n");

  const user = JSON.stringify({ ticket: { title, description }, categories });

  return { system, user };
};

const parseJsonResponse = (raw) => {
  if (!raw || typeof raw !== "string") {
    throw new Error("AI returned an empty response");
  }

  let text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      text = text.slice(first, last + 1);
    }
  }

  return JSON.parse(text);
};

const callOpenai = async ({
  apiKey,
  model,
  system,
  user,
  endpoint = OPENAI_ENDPOINT,
  authScheme = "Bearer",
  extraHeaders = {},
  jsonMode = true,
  timeoutMs,
}) => {
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const response = await axios.post(endpoint, body, {
    headers: {
      "Content-Type": "application/json",
      // Локальные серверы моделей ключа не спрашивают
      ...(apiKey ? { Authorization: `${authScheme} ${apiKey}` } : {}),
      ...extraHeaders,
    },
    ...(timeoutMs ? { timeout: timeoutMs } : {}),
  });

  return response.data?.choices?.[0]?.message?.content;
};

// DeepSeek использует тот же протокол, что и OpenAI.
const callDeepseek = (params) =>
  callOpenai({ ...params, endpoint: DEEPSEEK_ENDPOINT });

// Зеркало backend/services/aiService.js: в настройках лежит путь без каталога,
// но принимаем и целый URI, и «модель/версия», и голое имя.
const buildYandexModelUri = (folderId, model) => {
  const value = String(model || "").trim();

  if (value.startsWith("gpt://")) return value;
  if (value.includes("/")) return `gpt://${folderId}/${value}`;

  return `gpt://${folderId}/${value}/latest`;
};

// Yandex AI Studio — OpenAI-совместимый шлюз: Api-Key + x-folder-id, модель
// задаётся полным modelUri.
const callYandexAi = ({ apiKey, model, folderId, system, user }) => {
  if (!folderId) throw new Error("Yandex AI Studio folder ID is not set");
  if (!String(model || "").trim())
    throw new Error("Yandex AI Studio model is not set");

  return callOpenai({
    apiKey,
    model: buildYandexModelUri(folderId, model),
    system,
    user,
    endpoint: YANDEX_AI_STUDIO_ENDPOINT,
    authScheme: "Api-Key",
    extraHeaders: { "x-folder-id": folderId },
    jsonMode: false,
  });
};

const callAnthropic = async ({ apiKey, model, system, user }) => {
  const response = await axios.post(
    ANTHROPIC_ENDPOINT,
    {
      model,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
    },
  );

  return response.data?.content?.[0]?.text;
};

// Зеркало backend/services/aiService.js: Ollama, LM Studio, vLLM и llama.cpp
// отдают OpenAI-совместимый /v1, различаясь только адресом.
const LOCAL_TIMEOUT_MS = 4 * 60 * 1000;

const buildLocalBaseUrl = (raw) => {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Local model base URL is not set");

  const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Local model base URL is malformed");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/v1"}`;
};

const callLocal = async ({ apiKey, model, baseUrl, system, user }) => {
  if (!String(model || "").trim()) throw new Error("Local model is not set");

  const params = {
    apiKey,
    model,
    system,
    user,
    endpoint: `${buildLocalBaseUrl(baseUrl)}/chat/completions`,
    timeoutMs: LOCAL_TIMEOUT_MS,
  };

  try {
    return await callOpenai({ ...params, jsonMode: true });
  } catch (error) {
    // Часть сборок llama.cpp отвечает 400 на response_format
    if (error?.response?.status !== 400) throw error;
    return callOpenai({ ...params, jsonMode: false });
  }
};

const PROVIDER_CALLERS = {
  openai: callOpenai,
  anthropic: callAnthropic,
  deepseek: callDeepseek,
  yandexai: callYandexAi,
  local: callLocal,
};

// Локальный сервер ключа не требует
const needsApiKey = (provider) => provider !== "local";

// Ключ в базе лежит шифртекстом secretBox; значения, сохранённые до ввода
// шифрования, читаются как есть (зеркало helpers/preferencesSecrets бэкенда).
const readStoredSecret = (stored) => {
  if (!stored) return "";

  return isEncrypted(stored) ? decryptSecret(stored) : stored;
};

const MAX_RULES = 8;

const rulesFor = async (companyId) => {
  if (!companyId) return "";

  try {
    const rules = await AiFeedback.find({ isActive: true, "company._id": companyId })
      .select("text")
      .sort({ updatedAt: -1 })
      .limit(MAX_RULES)
      .lean();

    const lines = rules
      .map((rule) => String(rule.text || "").trim())
      .filter(Boolean)
      .map((text) => `- ${text}`);

    if (!lines.length) return "";

    return (
      "\n\nЗамечания сотрудников по прошлым ответам в этой области — учти их и не повторяй разобранных ошибок:\n" +
      lines.join("\n")
    );
  } catch (error) {
    logger.log("warn", "Failed to load AI rules", { error: error.message });
    return "";
  }
};

const generateJson = async ({ system, user }) => {
  const preferences = await Preferences.findOne({});
  const ai = preferences?.ai;

  if (!ai?.isActive) throw new Error("AI features are disabled");

  const provider = ai.provider;
  const providerConfig = provider ? ai[provider] : null;
  const apiKey = readStoredSecret(providerConfig?.apiKey);
  const model = providerConfig?.model;
  const folderId = providerConfig?.folderId;
  const baseUrl = providerConfig?.baseUrl;

  if (!apiKey && needsApiKey(provider))
    throw new Error(`API key for ${provider || "AI provider"} is not set`);

  const call = PROVIDER_CALLERS[provider];
  if (!call) throw new Error(`Unsupported AI provider: ${provider}`);

  const raw = await call({ apiKey, model, folderId, baseUrl, system, user });

  return parseJsonResponse(raw);
};

const logAiTicketEvent = async (ticketId, event, severity = "info") => {
  try {
    await new TicketLog({ ticketId, user: AI_USER, severity, event }).save();
  } catch (error) {
    logger.log("error", "Failed to write AI ticket log", {
      ticketId: String(ticketId),
      event,
      error: error.message,
    });
  }
};

/**
 * Автоопределение категории заявки, созданной из Telegram. Заполняет categoryId
 * только если он пуст. Никогда не бросает исключение — ошибки только в лог.
 */
exports.detectTicketCategory = async (ticketId) => {
  try {
    const ticket = await Ticket.findById(ticketId).select(
      "num title description htmlDescription categoryId aiCategory company",
    );

    if (!ticket) return null;
    if (ticket.categoryId) return null;

    const categories = await TicketCategory.find({ isActive: true }).select(
      "title description",
    );

    if (!categories.length) {
      if (ticket.aiCategory?.status === "pending") {
        await Ticket.findByIdAndUpdate(ticketId, {
          "aiCategory.status": "processed",
        });
      }
      return null;
    }

    await Ticket.findByIdAndUpdate(ticketId, {
      aiCategory: { status: "pending" },
    });
    await logAiTicketEvent(ticketId, "начал подбор категории заявки");

    const description = truncate(
      stripHtml(ticket.description || ticket.htmlDescription),
    );

    const candidates = categories.map((category) => ({
      id: category._id.toString(),
      title: category.title,
      description: truncate(
        category.description || "",
        MAX_CATEGORY_DESCRIPTION_LENGTH,
      ),
    }));

    const { system, user } = buildCategoryPrompt({
      title: ticket.title || "",
      description,
      categories: candidates,
    });

    // Замечания сотрудников по прошлым подборам для этой компании — зеркало
    // backend/services/aiRules.js: правило появляется из живой ошибки и
    // применяется, только когда администратор его включил
    const data = await generateJson({
      system: system + (await rulesFor(ticket.company?._id)),
      user,
    });

    const chosenId =
      typeof data?.categoryId === "string" ? data.categoryId.trim() : "";
    const match = candidates.find((candidate) => candidate.id === chosenId);

    if (!match) {
      await Ticket.findByIdAndUpdate(ticketId, {
        "aiCategory.status": "processed",
      });
      await logAiTicketEvent(
        ticketId,
        "ИИ не нашёл подходящую категорию для заявки",
        "warning",
      );
      return null;
    }

    await Ticket.findByIdAndUpdate(ticketId, {
      categoryId: chosenId,
      "aiCategory.status": "processed",
    });
    await logAiTicketEvent(
      ticketId,
      `определил категорию заявки: «${match.title}»`,
    );

    logger.log("info", "Telegram ticket category detected", {
      ticketId: String(ticketId),
      num: ticket.num,
      categoryId: chosenId,
    });

    return chosenId;
  } catch (error) {
    logger.log("error", "Failed to detect telegram ticket category", {
      ticketId: String(ticketId),
      error: error.message,
    });
    await Ticket.findByIdAndUpdate(ticketId, {
      "aiCategory.status": "error",
    }).catch(() => {});
    await logAiTicketEvent(
      ticketId,
      `Ошибка автоопределения категории заявки: ${error.message}`,
      "danger",
    );
    return null;
  }
};
