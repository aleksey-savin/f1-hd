const { Ticket } = require("@/models/ticket");
const Company = require("@/models/company");
const logger = require("@/utils/logger");

const aiService = require("./aiService");
const SYSTEM_PROMPT = require("@/prompts/ticketGuide");
const {
  collectAttachments,
  extractAttachments,
} = require("./attachmentExtractor");

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

    // Vision can fail if the configured model isn't multimodal — fall back to a
    // text-only request so a guide is still produced.
    let result;
    try {
      result = await aiService.generateJson({
        system: SYSTEM_PROMPT,
        user,
        images,
      });
    } catch (error) {
      if (images.length) {
        logger.log("warn", "AI guide: retrying without images", {
          ticketId,
          error: error.message,
        });
        result = await aiService.generateJson({ system: SYSTEM_PROMPT, user });
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

    const aiGuide = {
      status: "error",
      error: error.message || "Не удалось сгенерировать руководство",
    };

    await Ticket.findByIdAndUpdate(ticketId, { aiGuide }).catch(() => {});

    return aiGuide;
  }
};
