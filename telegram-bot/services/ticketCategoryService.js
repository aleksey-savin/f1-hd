const axios = require("axios");

const { Ticket } = require("../models/ticket");
const TicketCategory = require("../models/ticketCategory");
const Preferences = require("../models/preferences");
const TicketLog = require("../models/ticketLog");
const logger = require("../utils/logger");

// Самодостаточное зеркало backend/services/ticketCategoryService.js (+ aiService,
// prompts/ticketCategory). telegram-bot — отдельный сервис со своими моделями и без
// общего кода с backend, поэтому логика автоопределения категории продублирована
// здесь. При изменении промпта/логики в backend синхронизируйте этот файл.

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

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
    "Отвечай СТРОГО в формате JSON без какого-либо текста вокруг:",
    '{ "categoryId": "<id выбранной категории или null>", "reason": "краткое обоснование на русском" }',
    "categoryId должен быть либо ровно одним из id переданных категорий, либо null.",
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

const callOpenai = async ({ apiKey, model, system, user }) => {
  const response = await axios.post(
    OPENAI_ENDPOINT,
    {
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  return response.data?.choices?.[0]?.message?.content;
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

const generateJson = async ({ system, user }) => {
  const preferences = await Preferences.findOne({});
  const ai = preferences?.ai;

  if (!ai?.isActive) throw new Error("AI features are disabled");

  const provider = ai.provider;
  const providerConfig = provider ? ai[provider] : null;
  const apiKey = providerConfig?.apiKey;
  const model = providerConfig?.model;

  if (!apiKey)
    throw new Error(`API key for ${provider || "AI provider"} is not set`);

  const raw =
    provider === "openai"
      ? await callOpenai({ apiKey, model, system, user })
      : await callAnthropic({ apiKey, model, system, user });

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
      "num title description htmlDescription categoryId aiCategory",
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

    const data = await generateJson({ system, user });

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
      );
      return null;
    }

    await Ticket.findByIdAndUpdate(ticketId, {
      categoryId: chosenId,
      "aiCategory.status": "processed",
    });
    await logAiTicketEvent(
      ticketId,
      `ИИ определил категорию заявки: «${match.title}»`,
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
