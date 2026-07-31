const { Ticket } = require("@/models/ticket");
const KnowledgeNote = require("@/models/knowledgeNote");
const { AppError } = require("@/middleware/errorHandling");
const { markdownToPlainText } = require("@/helpers/markdownToPlainText");
const { rescanNoteDerived } = require("@/helpers/knowledgeNoteDerived");
const logger = require("@/utils/logger");

const aiService = require("./aiService");
const TERMS_PROMPT = require("@/prompts/ticketTerms");
const REFERENCE_PROMPT = require("@/prompts/termReference");
const { rulesFor } = require("./aiRules");
const { humanizeAiError } = require("./aiErrors");

// Понятийный аппарат заявки и справка по каждому понятию.
//
// Разделение, на котором всё держится: СПРАВКА — про предмет («что такое
// Proxmox Backup Server»), РУКОВОДСТВО (services/ticketAiGuide.js) — про эту
// заявку («что сделать по ней»). Справка переиспользуема и потому имеет смысл
// вне заявки: сохранённая в базу знаний, она приезжает в следующую такую заявку
// обычным подбором заметок, уже без вызова модели.
//
// Всё — по требованию. Разбор стоит вызова модели, справка — ещё одного, и
// платить за них на каждой созданной заявке незачем: 96 % заявок закрываются
// без единого вопроса к предмету.

const MAX_TERMS = 5;
const MAX_LINKS = 3;
const MAX_BLOCKS = 4;
const MAX_BLOCK_ITEMS = 7;
const CONTEXT_LENGTH = 1200;
const LINK_TIMEOUT_MS = 6000;
// Разбор идёт в живом запросе — перезапуск процесса убивает его молча, и без
// срока строка понятий осталась бы «разбираем…» навсегда (тот же канон, что у
// руководства и расшифровки)
const PENDING_TTL_MS = 5 * 60 * 1000;
const INTERRUPTED = "разбор прервался, запустите его заново";

// Локальный stripHtml/truncate — так же, как они дублируются в ticketAiGuide.js
// и ticketCategoryService.js: сервисы промптов намеренно не делят
// вспомогательные функции, чтобы правка одного молча не меняла ответы другого.
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

const truncate = (value, max = CONTEXT_LENGTH) => {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

// Сравнение понятий и поиск их в тексте: без учёта регистра и различия ё/е
const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim();

const ticketPlainText = (ticket) =>
  `${ticket.title || ""}\n${stripHtml(ticket.description || ticket.htmlDescription)}`;

const ticketContext = (ticket) =>
  [
    `Заявка № ${ticket.num}`,
    ticket.title ? `Тема: ${ticket.title}` : null,
    `Описание: ${truncate(stripHtml(ticket.description || ticket.htmlDescription)) || "(не указано)"}`,
    ticket.categoryId?.title ? `Категория: ${ticket.categoryId.title}` : null,
  ]
    .filter(Boolean)
    .join("\n");

const scopeOf = (ticket) => ({
  categoryId: ticket.categoryId?._id ?? ticket.categoryId,
  companyId: ticket.company?._id,
});

/**
 * Живость ссылок проверяем сами: выдуманный адрес — самый частый грех модели, и
 * мёртвая ссылка в справке дороже отсутствующей. Белого списка доменов нет
 * намеренно — производителей столько же, сколько предметов, и список пришлось бы
 * дописывать под каждую новую заявку.
 */
const verifyDocLinks = async (links) => {
  const seen = new Set();
  const candidates = (Array.isArray(links) ? links : [])
    .map((link) => ({
      url: String(link?.url || "").trim(),
      title: String(link?.title || "").trim(),
    }))
    .filter((link) => /^https?:\/\//i.test(link.url))
    .filter((link) => (seen.has(link.url) ? false : seen.add(link.url)))
    // Проверка стоит запроса наружу — не гоняем её по всему, что придумалось
    .slice(0, MAX_LINKS * 2);

  const checked = await Promise.all(
    candidates.map(async (link) => {
      try {
        const host = new URL(link.url).hostname;
        const probe = (method) =>
          fetch(link.url, {
            method,
            redirect: "follow",
            signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
          });

        let response = await probe("HEAD");
        // Часть серверов документации HEAD не умеет или отдаёт на него отказ
        if ([403, 405, 501].includes(response.status)) {
          response = await probe("GET");
        }
        if (response.status >= 400) return null;

        return { url: link.url, title: link.title || host, host };
      } catch {
        return null;
      }
    }),
  );

  return checked.filter(Boolean).slice(0, MAX_LINKS);
};

const normalizeBlocks = (blocks) =>
  (Array.isArray(blocks) ? blocks : [])
    .map((block) => {
      const kind = ["text", "list", "steps"].includes(block?.kind)
        ? block.kind
        : "text";
      const items = (Array.isArray(block?.items) ? block.items : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, MAX_BLOCK_ITEMS);
      const text = String(block?.text || "").trim();

      if (kind === "text" ? !text : !items.length) return null;

      return {
        title: String(block?.title || "").trim(),
        kind,
        text: kind === "text" ? text : "",
        items: kind === "text" ? [] : items,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_BLOCKS);

/**
 * Разбирает заявку на предметные понятия. Не бросает исключений — отказ
 * записывается в `aiTerms.status`, как у руководства.
 *
 * @returns {Promise<object|null>} группа aiTerms или null, если заявки нет
 */
exports.analyzeTicketTerms = async (ticketId) => {
  await Ticket.findByIdAndUpdate(ticketId, {
    "aiTerms.status": "pending",
    "aiTerms.startedAt": new Date(),
    "aiTerms.error": "",
  }).catch(() => {});

  try {
    const ticket = await Ticket.findById(ticketId)
      .select("num title description htmlDescription categoryId company")
      .populate({ path: "categoryId", select: "title" });

    if (!ticket) {
      logger.log("warn", "AI terms: ticket not found", { ticketId });
      return null;
    }

    const { data } = await aiService.generateJson({
      system: TERMS_PROMPT + (await rulesFor(scopeOf(ticket))),
      user: ticketContext(ticket),
    });

    const text = ticketPlainText(ticket);
    const seen = new Set();
    const items = (Array.isArray(data.terms) ? data.terms : [])
      .map((term) => String(term || "").trim())
      .filter(Boolean)
      .filter((term) => (seen.has(normalize(term)) ? false : seen.add(normalize(term))))
      .slice(0, MAX_TERMS)
      // inText считаем кодом, а не спрашиваем у модели: от этого зависит,
      // подчеркнём мы слово прямо в описании или покажем строкой «Ещё в теме»,
      // а граница между словами человека и домыслом модели должна быть точной
      .map((term) => ({ term, inText: normalize(text).includes(normalize(term)) }));

    const aiTerms = {
      status: "ready",
      items,
      error: "",
      generatedAt: new Date(),
    };

    await Ticket.findByIdAndUpdate(ticketId, { aiTerms });

    logger.log("info", "Ticket terms analyzed", {
      ticketId: String(ticketId),
      num: ticket.num,
      count: items.length,
    });

    return aiTerms;
  } catch (error) {
    logger.log("error", "Failed to analyze ticket terms", {
      ticketId: String(ticketId),
      error: error.message,
      stack: error.stack,
    });

    // В хронику не пишем: разбор — подручное средство читателя заявки, а не
    // событие её жизни. Причину человек видит строкой у самих понятий.
    const aiTerms = {
      status: "error",
      error: humanizeAiError(error, "не удалось разобрать заявку"),
    };
    await Ticket.findByIdAndUpdate(ticketId, { aiTerms }).catch(() => {});

    return aiTerms;
  }
};

/**
 * Справка по понятию. Уже составленную возвращает как есть — открытие справки
 * по разобранному термину должно быть чтением, а не новой генерацией.
 *
 * @returns {Promise<object>} { term, inText, reference }
 */
exports.buildTermReference = async (ticketId, term) => {
  const ticket = await Ticket.findById(ticketId)
    .select("num title description htmlDescription categoryId company aiTerms")
    .populate({ path: "categoryId", select: "title" });

  if (!ticket) throw new AppError("Ticket not found", 404, true);

  const entry = (ticket.aiTerms?.items || []).find(
    (item) => normalize(item.term) === normalize(term),
  );
  if (!entry) {
    throw new AppError("Term does not belong to the ticket", 404, true);
  }
  if (entry.reference?.generatedAt) {
    return entry.toObject ? entry.toObject() : entry;
  }

  const { data, provider, model } = await aiService.generateJson({
    system: REFERENCE_PROMPT + (await rulesFor(scopeOf(ticket))),
    user: [
      `Понятие: ${entry.term}`,
      "",
      "Заявка, в которой оно встретилось, — только чтобы выбрать нужное значение термина:",
      ticketContext(ticket),
    ].join("\n"),
  });

  const reference = {
    summary: String(data.summary || "").trim(),
    blocks: normalizeBlocks(data.blocks),
    links: await verifyDocLinks(data.links),
    provider,
    model,
    generatedAt: new Date(),
  };

  await Ticket.updateOne(
    { _id: ticketId, "aiTerms.items.term": entry.term },
    { $set: { "aiTerms.items.$.reference": reference } },
  );

  logger.log("info", "Term reference generated", {
    ticketId: String(ticketId),
    num: ticket.num,
    term: entry.term,
    links: reference.links.length,
  });

  return { term: entry.term, inText: entry.inText, reference };
};

// Справка → markdown заметки. Заголовки блоков остаются заголовками, шаги —
// нумерованным списком: заметку потом правит человек в обычном редакторе.
const referenceToMarkdown = (term, reference, ticketNum) => {
  const parts = [];

  if (reference.summary) parts.push(reference.summary);

  for (const block of reference.blocks || []) {
    if (block.title) parts.push(`## ${block.title}`);
    if (block.kind === "text") {
      parts.push(block.text);
    } else {
      parts.push(
        (block.items || [])
          .map((item, index) =>
            block.kind === "steps" ? `${index + 1}. ${item}` : `- ${item}`,
          )
          .join("\n"),
      );
    }
  }

  if (reference.links?.length) {
    parts.push("## Официальная документация");
    parts.push(
      reference.links.map((link) => `- [${link.title}](${link.url})`).join("\n"),
    );
  }

  parts.push(
    `_Справку составил ИИ по заявке № ${ticketNum}. Проверьте факты и ссылки, прежде чем полагаться на неё._`,
  );

  return parts.filter(Boolean).join("\n\n");
};

/**
 * Сохраняет справку заметкой базы знаний. Заметка создаётся неодобренной, как и
 * любая другая, — модерация и есть тот человек, который отделяет проверенное
 * знание от предположения модели.
 *
 * @returns {Promise<object>} созданная заметка
 */
exports.saveReferenceAsNote = async (ticketId, term, userId) => {
  const ticket = await Ticket.findById(ticketId)
    .select("num categoryId aiTerms")
    .populate({ path: "categoryId", select: "title" });

  if (!ticket) throw new AppError("Ticket not found", 404, true);

  const entry = (ticket.aiTerms?.items || []).find(
    (item) => normalize(item.term) === normalize(term),
  );
  if (!entry?.reference?.generatedAt) {
    throw new AppError(
      "Справка ещё не составлена — откройте её и попробуйте снова",
      400,
      true,
    );
  }

  const content = referenceToMarkdown(
    entry.term,
    entry.reference,
    ticket.num,
  );

  const note = new KnowledgeNote({
    title: entry.term,
    content,
    plainText: markdownToPlainText(content),
    // Привязка к категории заявки: без неё заметка не попадёт в подбор и справку
    // придётся генерировать заново на каждой такой заявке
    categories: ticket.categoryId?._id
      ? [{ _id: ticket.categoryId._id, title: ticket.categoryId.title }]
      : [],
    type: "info",
    createdBy: userId,
    updatedBy: userId,
  });

  await rescanNoteDerived(note);
  await note.save();

  logger.log("info", "Term reference saved as knowledge note", {
    noteId: String(note._id),
    term: entry.term,
    num: ticket.num,
  });

  return note;
};

/**
 * Гасит зависший разбор при чтении заявки. В хронику, в отличие от руководства,
 * не пишем: строка понятий показывает причину сама, а событием жизни заявки
 * прерванный разбор не является.
 */
exports.expireStalePendingTerms = async (ticket) => {
  const terms = ticket?.aiTerms;
  if (terms?.status !== "pending") return ticket;

  const startedAt = terms.startedAt ? new Date(terms.startedAt).getTime() : 0;
  if (startedAt && Date.now() - startedAt < PENDING_TTL_MS) return ticket;

  await Ticket.findByIdAndUpdate(ticket._id, {
    "aiTerms.status": "error",
    "aiTerms.error": INTERRUPTED,
  }).catch(() => {});

  ticket.aiTerms = { ...terms, status: "error", error: INTERRUPTED };

  return ticket;
};
