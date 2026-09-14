const { Ticket } = require("@/models/ticket");
const TicketCategory = require("@/models/ticketCategory");
const logger = require("@/utils/logger");

const aiService = require("./aiService");
const { rulesFor } = require("./aiRules");
const buildCategoryPrompt = require("@/prompts/ticketCategory");
const { MAX_TITLE_LENGTH } = require("@/helpers/deriveTicketTitle");
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
 * Возвращает структурированный результат (для запуска по запросу пользователя с
 * обратной связью); фоновые вызовы результат игнорируют.
 *
 * Тем же проходом пишется тема заявки, если её ждут (`aiTitle.status` =
 * pending). Подбор категории и тема включаются в настройках по отдельности:
 * при `category: false` проход только пишет тему, категории не трогает.
 *
 * @param {string|object} ticketId
 * @param {{ category?: boolean }} [options]
 * @returns {Promise<{ outcome: "assigned"|"not_found"|"already_set"|"no_categories"|"title_only"|"error",
 *   categoryId?: string|null, categoryTitle?: string, reason?: string,
 *   closest?: string[], error?: string }>}
 */
exports.detectTicketCategory = async (ticketId, { category = true } = {}) => {
  try {
    const ticket = await Ticket.findById(ticketId).select(
      "num title description htmlDescription categoryId aiCategory aiTitle company",
    );

    if (!ticket) {
      logger.log("warn", "Category detection: ticket not found", { ticketId });
      return { outcome: "error", error: "ticket not found" };
    }

    // Ранние выходы обязаны снять ожидание темы: она едет этим же проходом, и
    // без снятия pending висел бы вечно, а метка ✦ так и не появилась бы.
    const dropPendingTitle = async () => {
      if (ticket.aiTitle?.status !== "pending") return;
      await Ticket.findByIdAndUpdate(ticketId, {
        $unset: { aiTitle: "" },
      }).catch(() => {});
    };

    // Не перезаписываем уже выбранную категорию (например, заданную оператором).
    if (ticket.categoryId) {
      await dropPendingTitle();
      return { outcome: "already_set", categoryId: ticket.categoryId.toString() };
    }

    const needsTitle = ticket.aiTitle?.status === "pending";
    if (!category && !needsTitle) return { outcome: "title_only" };

    const categories = category
      ? await TicketCategory.find({ isActive: true }).select("title description")
      : [];

    if (category && !categories.length) {
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
      await dropPendingTitle();
      return { outcome: "no_categories" };
    }

    // Помечаем заявку как обрабатываемую ИИ и фиксируем старт в логе заявки.
    if (category) {
      await Ticket.findByIdAndUpdate(ticketId, {
        aiCategory: { status: "pending" },
      });
      await logAiTicketEvent(ticketId, "начал подбор категории заявки");
    }

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

    // Тему просим тем же вызовом, а не отдельным: у заявителя поля «Тема» нет,
    // и при создании там стоит обрезка описания, сделанная сервером. Заявку
    // модель уже читает целиком — второй запрос был бы платой ни за что.
    const { system, user } = buildCategoryPrompt({
      title: ticket.title || "",
      description,
      categories: candidates,
      needsTitle,
      needsCategory: category,
    });

    // Замечания сотрудников по прошлым подборам для этой компании — правила
    // включает администратор, см. services/aiRules.js
    const rules = await rulesFor({ companyId: ticket.company?._id });

    const { data } = await aiService.generateJson({ system: system + rules, user });

    const chosenId =
      typeof data?.categoryId === "string" ? data.categoryId.trim() : "";
    const match = candidates.find((candidate) => candidate.id === chosenId);
    const reason = typeof data?.reason === "string" ? data.reason : "";

    // Ближайшие кандидаты для обратной связи при запуске по запросу — только
    // названия (их читает человек), без id. Берём валидные id из ответа модели,
    // исключаем уже выбранный, максимум 3.
    const closest = (Array.isArray(data?.closest) ? data.closest : [])
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .map((id) => candidates.find((candidate) => candidate.id === id))
      .filter((candidate) => candidate && candidate.id !== chosenId)
      .slice(0, 3)
      .map((candidate) => candidate.title);

    // Тема живёт отдельно от категории: категорию модель могла не выбрать, а
    // тему написать — и наоборот. Метку ✦ у заголовка карточки даёт статус
    // processed, поэтому его ставим ТОЛЬКО когда тема действительно заменена, —
    // иначе метка стояла бы у строки, которую ИИ не писал. Не получилось —
    // снимаем поле целиком, чтобы pending не висел вечно.
    const aiTitle =
      needsTitle && typeof data?.title === "string"
        ? data.title
            .trim()
            .replace(/^["«']+|["»']+$/gu, "")
            .trim()
            .slice(0, MAX_TITLE_LENGTH)
        : "";

    const setOps = category ? { "aiCategory.status": "processed" } : {};
    const unsetOps = {};
    if (needsTitle) {
      if (aiTitle) {
        setOps.title = aiTitle;
        setOps["aiTitle.status"] = "processed";
      } else {
        unsetOps.aiTitle = "";
      }
      await logAiTicketEvent(
        ticketId,
        aiTitle
          ? `ИИ написал тему заявки: «${aiTitle}»`
          : "не смог написать тему заявки — осталась выведенная из описания",
        aiTitle ? "info" : "warning",
      );
    }
    const buildUpdate = (extra = {}) => {
      const set = { ...setOps, ...extra };
      return {
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(Object.keys(unsetOps).length ? { $unset: unsetOps } : {}),
      };
    };

    // Подбор категории выключен — проход писал только тему
    if (!category) {
      if (Object.keys(setOps).length || Object.keys(unsetOps).length) {
        await Ticket.findByIdAndUpdate(ticketId, buildUpdate());
      }
      return { outcome: "title_only" };
    }

    if (!match) {
      logger.log("info", "Category detection: no confident match", {
        ticketId: ticket._id.toString(),
        num: ticket.num,
        chosenId: chosenId || null,
        reason: reason || undefined,
      });
      await Ticket.findByIdAndUpdate(ticketId, buildUpdate());
      await logAiTicketEvent(
        ticketId,
        "не нашёл подходящую категорию для заявки",
        "warning",
      );
      return { outcome: "not_found", categoryId: null, reason, closest };
    }

    await Ticket.findByIdAndUpdate(
      ticketId,
      buildUpdate({ categoryId: chosenId }),
    );

    logger.log("info", "Ticket category detected", {
      ticketId: ticket._id.toString(),
      num: ticket.num,
      categoryId: chosenId,
    });
    await logAiTicketEvent(
      ticketId,
      `ИИ определил категорию заявки: «${match.title}»`,
    );

    return {
      outcome: "assigned",
      categoryId: chosenId,
      categoryTitle: match.title,
      reason,
      closest,
    };
  } catch (error) {
    logger.log("error", "Failed to detect ticket category", {
      ticketId: typeof ticketId === "object" ? ticketId?.toString() : ticketId,
      error: error.message,
      stack: error.stack,
    });
    // Тема ехала этим же вызовом — снимаем её ожидание вместе с ошибкой
    // категории, иначе заявка останется с вечным pending и без метки.
    await Ticket.findByIdAndUpdate(ticketId, {
      ...(category ? { $set: { "aiCategory.status": "error" } } : {}),
      $unset: { aiTitle: "" },
    }).catch(() => {});
    await logAiTicketEvent(
      ticketId,
      `Ошибка автоопределения категории заявки: ${error.message}`,
      "danger",
    );
    return { outcome: "error", error: error.message };
  }
};
