const { Ticket } = require("@/models/ticket");
const Company = require("@/models/company");
const Work = require("@/models/work");
const logger = require("@/utils/logger");

const aiService = require("./aiService");
const SYSTEM_PROMPT = require("@/prompts/ticketGuide");
const {
  collectAttachments,
  extractAttachments,
} = require("./attachmentExtractor");
const {
  collectRelevantNotes,
  buildKnowledgeContext,
} = require("./knowledgeBaseContext");
const { logAiTicketEvent } = require("./aiTicketLog");
const { humanizeAiError } = require("./aiErrors");
const { rulesFor } = require("./aiRules");

const MAX_COMMENTS = 20;
const MAX_FIELD_LENGTH = 2000;

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

const buildUserContent = (ticket, company) => {
  const lines = [];

  lines.push(`Заявка №${ticket.num}`);
  if (ticket.title) lines.push(`Тема: ${ticket.title}`);

  const description = stripHtml(ticket.description || ticket.htmlDescription);
  lines.push(`Описание: ${truncate(description) || "(не указано)"}`);

  if (ticket.categoryId?.title) {
    lines.push(`Категория: ${ticket.categoryId.title}`);
  }
  if (ticket.priority) lines.push(`Приоритет: ${ticket.priority}`);
  if (ticket.impact) lines.push(`Влияние: ${ticket.impact}`);
  if (ticket.urgency) lines.push(`Срочность: ${ticket.urgency}`);
  if (ticket.source) lines.push(`Источник: ${ticket.source}`);

  if (Array.isArray(ticket.customFields) && ticket.customFields.length) {
    const fields = ticket.customFields
      .filter((field) => field?.name)
      .map((field) => `${field.name}: ${field.value ?? ""}`)
      .join("; ");
    if (fields) lines.push(`Дополнительные поля: ${fields}`);
  }

  const applicant = ticket.applicantId;
  if (applicant) {
    const name = [applicant.firstName, applicant.lastName]
      .filter(Boolean)
      .join(" ");
    const parts = [name];
    if (applicant.position) parts.push(applicant.position);
    lines.push(`Заявитель: ${parts.filter(Boolean).join(", ") || "—"}`);
  }

  const companyName = company?.fullTitle || company?.alias || ticket.company?.alias;
  if (companyName) lines.push(`Компания: ${companyName}`);

  const comments = (ticket.comments || [])
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-MAX_COMMENTS);

  if (comments.length) {
    lines.push("\nКомментарии:");
    comments.forEach((comment) => {
      const author = comment.createdBy
        ? [comment.createdBy.firstName, comment.createdBy.lastName]
            .filter(Boolean)
            .join(" ")
        : "—";
      lines.push(`- [${author}] ${truncate(stripHtml(comment.content))}`);
    });
  }

  return lines.join("\n");
};

/**
 * Institutional memory for the prompt: what this company already asked about and
 * what we actually did. Cheaper than asking the client again — half of the
 * "уточняющих вопросов" the model used to produce were already answered in a
 * closed ticket of the same company.
 *
 * Scope is the ticket's OWN company (that's where the useful precedent is), same
 * category first, then the rest by recency. Per ticket we take the closing
 * comment (what the client was told) and the works' descriptions (what was
 * actually done).
 */
const PAST_TICKETS = 5;
const PAST_TEXT_LENGTH = 400;

const collectPastTickets = async (ticket) => {
  const companyId = ticket.company?._id;
  if (!companyId) return [];

  const categoryId = ticket.categoryId?._id ?? ticket.categoryId;

  const closed = await Ticket.find({
    _id: { $ne: ticket._id },
    "company._id": companyId,
    isClosed: true,
  })
    .select("num title categoryId closingComment finishedAt")
    .sort({ finishedAt: -1 })
    .limit(40)
    .lean();

  if (!closed.length) return [];

  const sameCategory = (item) =>
    categoryId && item.categoryId?.toString() === categoryId.toString();

  const ranked = [
    ...closed.filter(sameCategory),
    ...closed.filter((item) => !sameCategory(item)),
  ].slice(0, PAST_TICKETS);

  const works = await Work.find({
    tickets: { $in: ranked.map((item) => item._id) },
    finishedAt: { $ne: null },
  })
    .select("description visitRequired tickets")
    .lean();

  return ranked.map((item) => ({
    ...item,
    works: works.filter((work) =>
      (work.tickets || []).some(
        (id) => id.toString() === item._id.toString(),
      ),
    ),
  }));
};

// Итог заявки почти всегда шаблонный: из 400 закрытых у 390 он короче ста
// знаков и звучит как «Добрый день! Работы по заявке выполнены». Такой текст
// модели ничего не даёт — берём итог только когда он содержательный, а что
// именно сделали, рассказывают описания работ.
const MEANINGFUL_SUMMARY = 100;

const buildPastContext = (items) =>
  items
    .map((item) => {
      const lines = [`- №${item.num}: ${truncate(item.title, 160)}`];
      const closing = stripHtml(item.closingComment);
      if (closing.length >= MEANINGFUL_SUMMARY) {
        lines.push(`  итог: ${truncate(closing, PAST_TEXT_LENGTH)}`);
      }
      const done = item.works
        .map((work) =>
          [
            work.visitRequired ? "выезд" : "удалённо",
            truncate(stripHtml(work.description), 200),
          ]
            .filter(Boolean)
            .join(": "),
        )
        .filter(Boolean);
      if (done.length) lines.push(`  работы: ${done.join("; ")}`);
      return lines.join("\n");
    })
    .join("\n");

// Сборка идёт в живом запросе, и перезапуск процесса (деплой, nodemon) убивает
// её молча: исключения нет — значит, catch ниже статус не поправит, и заявка
// остаётся в pending навсегда, а панель опрашивает её раз в 4 секунды до
// скончания века. Поэтому у pending есть срок. Пять минут — с запасом: самая
// долгая живая сборка (документы + картинки + база знаний) укладывалась в две.
const PENDING_TTL_MS = 5 * 60 * 1000;

/**
 * Гасит зависший pending при чтении заявки — единственном месте, куда панель
 * ходит за статусом. Если сборка всё-таки жива, свой результат она запишет
 * поверх.
 *
 * @param {object} ticket план-объект заявки (мутируется на месте)
 */
exports.expireStalePendingGuide = async (ticket) => {
  const guide = ticket?.aiGuide;
  if (guide?.status !== "pending") return ticket;

  // Заявки, начатые до появления startedAt, гасим сразу: живая сборка перепишет
  const startedAt = guide.startedAt ? new Date(guide.startedAt).getTime() : 0;
  if (startedAt && Date.now() - startedAt < PENDING_TTL_MS) return ticket;

  const error = "сборка прервалась, запустите её заново";

  await Ticket.findByIdAndUpdate(ticket._id, {
    "aiGuide.status": "error",
    "aiGuide.error": error,
  }).catch(() => {});

  // Панель отсылает к хронике заявки — там должно быть что прочитать
  await logAiTicketEvent(
    ticket._id,
    "Сборка руководства ИИ прервалась: сервис перезапустился, пока она шла",
    "warning",
  );

  ticket.aiGuide = { ...guide, status: "error", error };

  return ticket;
};

const normalizeItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (typeof item === "string" ? item : item?.text))
    .filter((text) => typeof text === "string" && text.trim())
    .map((text) => ({ text: text.trim(), done: false }));
};

/**
 * Generate (or regenerate) the AI solution guide for a ticket and persist it on
 * the ticket document. Never throws — failures are recorded on aiGuide.status.
 *
 * @returns {Promise<object|null>} the resulting aiGuide sub-document
 */
exports.generateTicketAiGuide = async (ticketId) => {
  try {
    const ticket = await Ticket.findById(ticketId)
      .populate({ path: "categoryId", select: "title" })
      .populate({ path: "applicantId", select: "firstName lastName position" })
      .populate({ path: "comments", select: "content createdBy createdAt attachments", populate: { path: "createdBy", select: "firstName lastName" } });

    if (!ticket) {
      logger.log("warn", "AI guide: ticket not found", { ticketId });
      return null;
    }

    const company = ticket.company?._id
      ? await Company.findById(ticket.company._id).select("alias fullTitle")
      : null;

    let user = buildUserContent(ticket, company);

    // Pull text out of document attachments and base64-encode image attachments
    // so the model can analyze them too.
    const { images, documents } = await extractAttachments(
      collectAttachments(ticket),
    );

    if (documents.length) {
      user += `\n\nСодержимое прикреплённых документов:\n${documents
        .map((doc) => `--- ${doc.name} ---\n${doc.text}`)
        .join("\n\n")}`;
    }

    if (images.length) {
      user += `\n\nК заявке приложено изображений: ${images.length}. Они переданы ниже — учти их при анализе.`;
    }

    // Подмешиваем релевантные заметки базы знаний (известные проблемы, инструкции,
    // общая информация) — приоритетный источник для модели.
    const knowledgeNotes = await collectRelevantNotes({
      companyId: ticket.company?._id,
      categoryId: ticket.categoryId?._id,
      applicantId: ticket.applicantId?._id,
      // Привязка находит кандидатов, слова заявки решают, кто из них поедет
      title: ticket.title,
      text: stripHtml(ticket.description || ticket.htmlDescription),
    });

    if (knowledgeNotes.length) {
      user += `\n\nРелевантные заметки базы знаний (приоритетный источник — известные проблемы и инструкции):\n${buildKnowledgeContext(
        knowledgeNotes,
      )}`;
    }

    // Прошлые закрытые заявки этой же компании и что по ним сделали: половина
    // «уточняющих вопросов» уже отвечена там, а решение часто повторяется
    const pastTickets = await collectPastTickets(ticket);

    if (pastTickets.length) {
      user += `\n\nЗакрытые заявки этой компании и что по ним сделали (сначала та же категория). Опирайся на них: если похожая проблема уже решалась, повтори проверенный путь и не спрашивай то, что из них известно:\n${buildPastContext(
        pastTickets,
      )}`;
    }

    // Vision can fail if the configured model isn't multimodal — fall back to a
    // text-only request so a guide is still produced.
    // Замечания сотрудников по прошлым руководствам в этой области
    const system =
      SYSTEM_PROMPT +
      (await rulesFor({
        categoryId: ticket.categoryId?._id,
        companyId: ticket.company?._id,
      }));

    let result;
    try {
      result = await aiService.generateJson({
        system,
        user,
        images,
      });
    } catch (error) {
      if (images.length) {
        logger.log("warn", "AI guide: retrying without images", {
          ticketId,
          error: error.message,
        });
        result = await aiService.generateJson({ system, user });
      } else {
        throw error;
      }
    }

    const { data, provider, model } = result;

    const kind = data.kind === "questions" ? "questions" : "solution";
    const items = normalizeItems(data.items);

    const aiGuide = {
      status: "ready",
      kind,
      summary: typeof data.summary === "string" ? data.summary : "",
      items,
      sources: knowledgeNotes.map((note) => ({
        _id: note._id,
        title: note.title,
        type: note.type,
      })),
      provider,
      model,
      error: "",
      generatedAt: new Date(),
      generatedFromCommentCount: ticket.comments?.length || 0,
    };

    await Ticket.findByIdAndUpdate(ticketId, { aiGuide });

    logger.log("info", "AI guide generated", {
      ticketId,
      num: ticket.num,
      kind,
      itemCount: items.length,
    });

    return aiGuide;
  } catch (error) {
    logger.log("error", "Failed to generate AI guide", {
      ticketId,
      error: error.message,
      stack: error.stack,
    });

    // В заявку и в её хронику — человеческая причина; сырой ответ поставщика
    // остался выше, в логе сервера
    const reason = humanizeAiError(error, "не удалось собрать руководство");

    const aiGuide = { status: "error", error: reason };

    await Ticket.findByIdAndUpdate(ticketId, { aiGuide }).catch(() => {});

    await logAiTicketEvent(
      ticketId,
      `Ошибка формирования AI-руководства: ${reason}`,
      "danger",
    );

    return aiGuide;
  }
};
