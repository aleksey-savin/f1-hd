const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

const { toStems, scoreNote } = require("@/services/knowledgeBaseContext");
const { normalize, ticketPlainText, fallbackTerms, hasAllTerms } = require("./text");

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Имя → записи справочника (компании, люди, категории). Каждое слово запроса
 * должно встретиться в подписи; точное совпадение с одной из exact-подписей
 * побеждает остальные («Ромашка» не спорит с «Ромашка-Строй»).
 */
const resolveByName = (items, name, { label, exact }) => {
  const query = normalize(name).trim().replace(/\s+/g, " ");
  const words = query.split(" ").filter(Boolean);
  if (!words.length) return [];
  const matches = items.filter((item) => {
    const text = normalize(label(item));
    return words.every((word) => text.includes(word));
  });
  const exactMatches = matches.filter((item) =>
    exact(item).some((value) => normalize(value).trim() === query),
  );
  return exactMatches.length ? exactMatches : matches;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// «2026-09-31» от агента не превращаем молча в 1 октября — ошибка с подсказкой
const checkDay = (value, name) => {
  if (!DAY.test(String(value)) || dayjs.utc(value).format("YYYY-MM-DD") !== value) {
    throw new Error(`${name} must be a calendar day as YYYY-MM-DD, got "${value}"`);
  }
};

/**
 * Фильтр заявок для Mongo. Дни — в поясе организации, обе границы включительно,
 * по дате создания (docs/datetime-conventions.md: границы периода — dayjs.tz).
 * Открытость — только isClosed: isArchived мёртв, state бывает рассинхронен.
 */
const buildTicketFilter = ({ status = "any", companyIds, userIds, categoryIds, from, to, timezone: tz }) => {
  const filter = {};
  if (status === "open") filter.isClosed = false;
  if (status === "closed") filter.isClosed = true;
  if (companyIds) filter["company._id"] = { $in: companyIds };
  if (userIds) filter.applicantId = { $in: userIds };
  if (categoryIds) filter.categoryId = { $in: categoryIds };
  const createdAt = {};
  if (from) {
    checkDay(from, "from");
    createdAt.$gte = dayjs.tz(from, tz).startOf("day").toDate();
  }
  if (to) {
    checkDay(to, "to");
    createdAt.$lt = dayjs.tz(to, tz).add(1, "day").startOf("day").toDate();
  }
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;
  return filter;
};

const newestFirst = (a, b) => new Date(b.ticket.createdAt) - new Date(a.ticket.createdAt);

// Ранжирование идёт в том же процессе, что и веб-приложение: раз в YIELD_EVERY
// кандидатов отдаём цикл событий, иначе долгий поиск подвешивает интерфейс.
const YIELD_EVERY = 500;
const breathe = () => new Promise((resolve) => setImmediate(resolve));

/** Проход по кандидатам с передышками; visit возвращает запись или null. */
const scan = async (items, visit) => {
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    if (i > 0 && i % YIELD_EVERY === 0) await breathe();
    const entry = visit(items[i]);
    if (entry) out.push(entry);
  }
  return out;
};

/**
 * Поиск по словам: основы как у базы знаний (заголовок 3, текст 1), иначе
 * подстрока. Только для непустого запроса: без слов инструмент листает базу по
 * дате, а номер заявки ищет сам (`num`).
 */
const rankTickets = async (tickets, query) => {
  const withText = await scan(tickets, (ticket) => ({ ticket, text: ticketPlainText(ticket) }));
  const stems = toStems(query);
  const byStems = stems.size
    ? await scan(withText, (entry) => {
        const score = scoreNote({ title: entry.ticket.title, plainText: entry.text }, stems);
        return score > 0 ? { ...entry, score } : null;
      })
    : [];
  if (byStems.length) {
    return { hits: byStems.sort((a, b) => b.score - a.score || newestFirst(a, b)), needles: [...stems] };
  }
  const terms = fallbackTerms(query);
  const bySubstring = await scan(withText, (entry) =>
    hasAllTerms(`${entry.ticket.title} ${entry.text}`, terms) ? { ...entry, score: 1 } : null,
  );
  return { hits: bySubstring.sort(newestFirst), needles: terms };
};

/** Похожие: основы заголовка и текста исходной заявки против кандидатов. */
const rankSimilar = async (source, candidates) => {
  const stems = toStems(`${source.title || ""} ${ticketPlainText(source)}`);
  if (!stems.size) return { hits: [], needles: [] };
  const sourceCategory = source.categoryId ? String(source.categoryId) : null;
  const sameCategory = (ticket) =>
    sourceCategory && String(ticket.categoryId || "") === sourceCategory ? 1 : 0;
  const scored = await scan(candidates, (ticket) => {
    const text = ticketPlainText(ticket);
    const score = scoreNote({ title: ticket.title, plainText: text }, stems);
    return score > 0 ? { ticket, text, score } : null;
  });
  const hits = scored.sort(
    (a, b) =>
      b.score - a.score ||
      sameCategory(b.ticket) - sameCategory(a.ticket) ||
      new Date(b.ticket.finishedAt || 0) - new Date(a.ticket.finishedAt || 0) ||
      newestFirst(a, b),
  );
  return { hits, needles: [...stems] };
};

module.exports = { resolveByName, buildTicketFilter, rankTickets, rankSimilar };
