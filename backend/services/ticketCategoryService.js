const { Ticket } = require("@/models/ticket");
const TicketCategory = require("@/models/ticketCategory");
const logger = require("@/utils/logger");

const aiService = require("./aiService");
const buildCategoryPrompt = require("@/prompts/ticketCategory");
const { logAiTicketEvent } = require("./aiTicketLog");

const MAX_FIELD_LENGTH = 2000;
const MAX_CATEGORY_DESCRIPTION_LENGTH = 600;

// Локальный stripHtml/truncate — так же, как они дублируются в ticketAiGuide.js и
// callerIdentityService.js; отдельный общий util ради двух мест не вводим.
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

/**
 * Автоопределение категории заявки по её теме/описанию и описаниям категорий.
 * Заполняет ticket.categoryId только если он пуст. Никогда не бросает исключение —
 * любые ошибки попадают только в лог (как в generateTicketAiGuide).
 *
 * @param {string|object} ticketId
 * @returns {Promise<string|null>} выбранный categoryId либо null
 */
exports.detectTicketCategory = async (ticketId) => {
  try {
    const ticket = await Ticket.findById(ticketId).select(
      "num title description htmlDescription categoryId aiCategory",
    );

    if (!ticket) {
      logger.log("warn", "Category detection: ticket not found", { ticketId });
      return null;
    }

    // Не перезаписываем уже выбранную категорию (например, заданную оператором).
    if (ticket.categoryId) return null;

    const categories = await TicketCategory.find({ isActive: true }).select(
      "title description",
    );

    if (!categories.length) {
      logger.log("info", "Category detection: no active categories", {
        ticketId: ticket._id.toString(),
        num: ticket.num,
      });
      // Не оставляем зависший статус «pending», если он был выставлен при создании.
      if (ticket.aiCategory?.status === "pending") {
        await Ticket.findByIdAndUpdate(ticketId, {
          "aiCategory.status": "processed",
        });
      }
      return null;
    }

    // Помечаем заявку как обрабатываемую ИИ и фиксируем старт в логе заявки.
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

    const { data } = await aiService.generateJson({ system, user });

    const chosenId =
      typeof data?.categoryId === "string" ? data.categoryId.trim() : "";
    const match = candidates.find((candidate) => candidate.id === chosenId);

    if (!match) {
      logger.log("info", "Category detection: no confident match", {
        ticketId: ticket._id.toString(),
        num: ticket.num,
        chosenId: chosenId || null,
        reason: typeof data?.reason === "string" ? data.reason : undefined,
      });
      await Ticket.findByIdAndUpdate(ticketId, {
        "aiCategory.status": "processed",
      });
      await logAiTicketEvent(
        ticketId,
        "не нашёл подходящую категорию для заявки",
      );
      return null;
    }

    await Ticket.findByIdAndUpdate(ticketId, {
      categoryId: chosenId,
      "aiCategory.status": "processed",
    });

    logger.log("info", "Ticket category detected", {
      ticketId: ticket._id.toString(),
      num: ticket.num,
      categoryId: chosenId,
    });
    await logAiTicketEvent(
      ticketId,
      `ИИ определил категорию заявки: «${match.title}»`,
    );

    return chosenId;
  } catch (error) {
    logger.log("error", "Failed to detect ticket category", {
      ticketId: typeof ticketId === "object" ? ticketId?.toString() : ticketId,
      error: error.message,
      stack: error.stack,
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
