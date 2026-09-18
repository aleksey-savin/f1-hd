const { resolveByName, buildTicketFilter, rankTickets, rankSimilar } = require("./ticketQuery");
const { aggregateTicketStats } = require("./ticketStats");
const {
  buildDirectory,
  isSystemUser,
  personLabel,
  formatTicketRow,
  formatTicketDetail,
  formatStats,
  ticketLink,
  oneLine,
} = require("./ticketFormat");
const { maskText } = require("./maskText");

/**
 * Инструменты заявок для ИИ-агента (spec 2026-09-17-mcp-tickets-design.md).
 * Доступ к данным приходит аргументом (ticketSource.js), поэтому модуль
 * проверяется на заготовках без базы.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SIMILAR_DEFAULT = 10;
const SIMILAR_MAX = 30;
const MAX_CANDIDATES = 20_000;
const MEANINGFUL_CLOSING = 100;

const errorResult = (text) => ({ isError: true, content: [{ type: "text", text }] });
const textResult = (text) => ({ content: [{ type: "text", text }] });
const clampInt = (value, min, max, fallback) =>
  Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;

const NAME_RULES = {
  company: { list: "companies", label: (c) => `${c.alias} ${c.fullTitle || ""}`, exact: (c) => [c.alias, c.fullTitle].filter(Boolean), show: (c) => c.alias },
  user: {
    list: "users",
    label: (u) => `${u.lastName || ""} ${u.firstName || ""}`,
    exact: (u) => [`${u.lastName} ${u.firstName}`, `${u.firstName} ${u.lastName}`],
    show: (u, dir) => `${u.lastName} ${u.firstName}${u.company?._id ? ` (${dir.companies.get(String(u.company._id))?.alias || "—"})` : ""}`,
  },
  category: { list: "categories", label: (k) => k.title, exact: (k) => [k.title], show: (k) => k.title },
};

// Имена из аргументов → id. Ноль или несколько совпадений — ошибка инструмента
// с подсказкой: агент уточняет имя, а не получает чужие заявки.
const resolveNames = (raw, dir, args) => {
  const ids = {};
  const labels = [];
  for (const kind of ["company", "user", "category"]) {
    const name = typeof args[kind] === "string" ? args[kind].trim() : "";
    if (!name) continue;
    const rule = NAME_RULES[kind];
    const matches = resolveByName(raw[rule.list], name, rule);
    if (!matches.length) return { error: `No ${kind} matches "${name}". Check the name or omit the filter.` };
    if (matches.length > 1) {
      const options = matches.slice(0, 10).map((item) => rule.show(item, dir)).join("; ");
      return { error: `Several ${kind === "category" ? "categories" : `${kind === "company" ? "companies" : "people"}`} match "${name}": ${options}. Repeat with a more specific name.` };
    }
    ids[`${kind}Ids`] = [matches[0]._id];
    labels.push(`${kind}: ${rule.show(matches[0], dir)}`);
  }
  return { ids, labels };
};

const periodLabel = (from, to) => (from || to ? `created ${from || "…"}…${to || "…"}` : null);

const createTicketTools = ({ source, baseUrl, log }) => {
  const logCall = (caller, tool, meta, started) =>
    log("info", "MCP tool call", { mcpKeyId: caller?.keyId, mcpKeyName: caller?.keyName, tool, ...meta, durationMs: Date.now() - started });

  const loadDirectoryContext = async (context) => {
    const raw = await source.loadDirectory();
    const directory = buildDirectory(raw);
    return { raw, directory, ctx: { directory, systemAccounts: context.systemAccounts, baseUrl } };
  };

  return {
    search: async (args = {}, caller, context) => {
      const started = Date.now();
      const { raw, directory, ctx } = await loadDirectoryContext(context);
      const names = resolveNames(raw, directory, args);
      if (names.error) {
        logCall(caller, "search_tickets", { error: "name" }, started);
        return errorResult(names.error);
      }
      const status = ["open", "closed", "any"].includes(args.status) ? args.status : "any";
      const limit = clampInt(args.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
      const page = clampInt(args.page, 1, 1000, 1);
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";

      let filter;
      try {
        filter = buildTicketFilter({ status, ...names.ids, from: args.from, to: args.to, timezone: context.timezone });
      } catch (error) {
        logCall(caller, "search_tickets", { error: "date" }, started);
        return errorResult(error.message);
      }

      let total;
      let entries;
      let capped = false;
      if (query) {
        // Номер заявки среди слов — эта заявка первой, а слова ищутся как обычно
        const numbers = [...new Set(query.split(/\s+/).filter((term) => /^\d+$/.test(term)))].map(Number);
        const byNum = numbers.length
          ? await source.findTickets({ ...filter, num: { $in: numbers } }, { sort: { createdAt: -1 }, limit: numbers.length })
          : [];
        const candidates = await source.findTickets(filter, { sort: { createdAt: -1 }, limit: MAX_CANDIDATES });
        capped = candidates.length >= MAX_CANDIDATES;
        const { hits, needles } = await rankTickets(candidates, query);
        const numbered = new Set(byNum.map((ticket) => String(ticket._id)));
        const ranked = [
          ...byNum.map((ticket) => ({ ticket, text: null })),
          ...hits.filter((hit) => !numbered.has(String(hit.ticket._id))),
        ];
        total = ranked.length;
        entries = ranked.slice((page - 1) * limit, page * limit).map((entry) => ({ ...entry, needles }));
      } else {
        total = await source.countTickets(filter);
        const rows = await source.findTickets(filter, { sort: { createdAt: -1 }, skip: (page - 1) * limit, limit });
        entries = rows.map((ticket) => ({ ticket, text: null }));
      }

      const summary = [`status: ${status}`, ...names.labels, periodLabel(args.from, args.to), query && `query: "${maskText(query)}"`]
        .filter(Boolean)
        .join("; ");
      logCall(caller, "search_tickets", { query: query.slice(0, 100), filters: summary, results: total }, started);

      if (!total) return textResult(`No tickets match (${summary}). Try other words, a wider period or fewer filters.`);
      // Страница за последней: пустой диапазон «showing 21–20» агент читал бы
      // как сбой, а не как «спроси страницу раньше».
      if (!entries.length) return textResult(`No tickets on page ${page} (${total} found). Ask for an earlier page.`);
      const first = (page - 1) * limit + 1;
      const last = first + entries.length - 1;
      // Упёрлись в потолок кандидатов — «Found N» считает не весь архив
      const window = capped ? `; ranked the newest ${MAX_CANDIDATES.toLocaleString("en-US")} tickets only` : "";
      const header = `Found ${total} tickets (${summary}); showing ${first}–${last}, ${query ? "best match first" : "newest first"}${window}.`;
      return textResult([header, ...entries.map((entry, i) => formatTicketRow(entry, first + i, ctx))].join("\n\n"));
    },

    getTicket: async (args = {}, caller, context) => {
      const started = Date.now();
      const num = Number(args.num);
      const { directory, ctx } = await loadDirectoryContext(context);
      const detail = Number.isInteger(num) && num > 0
        ? await source.loadTicketDetail(num, {
            works: Boolean(context.modules.timeTracking),
            devices: Boolean(context.modules.inventory),
            applicantIsSystem: (id) => isSystemUser(id, directory, context.systemAccounts),
          })
        : null;
      logCall(caller, "get_ticket", { num, found: Boolean(detail) }, started);
      if (!detail) return errorResult(`Ticket #${args.num} not found. Use a number from search_tickets.`);
      return textResult(formatTicketDetail(detail, ctx));
    },

    findSimilar: async (args = {}, caller, context) => {
      const started = Date.now();
      const num = Number(args.num);
      const { ctx } = await loadDirectoryContext(context);
      const [origin] = Number.isInteger(num) && num > 0 ? await source.findTickets({ num }, { limit: 1 }) : [];
      if (!origin) {
        logCall(caller, "find_similar_tickets", { num, found: false }, started);
        return errorResult(`Ticket #${args.num} not found. Use a number from search_tickets.`);
      }
      const status = args.status === "any" ? "any" : "closed";
      const sameCompany = args.scope !== "all" && origin.company?._id;
      const limit = clampInt(args.limit, 1, SIMILAR_MAX, SIMILAR_DEFAULT);
      const filter = {
        ...buildTicketFilter({ status, companyIds: sameCompany ? [origin.company._id] : undefined, timezone: context.timezone }),
        _id: { $ne: origin._id },
      };
      const candidates = await source.findTickets(filter, { sort: { createdAt: -1 }, limit: MAX_CANDIDATES });
      const { hits, needles } = await rankSimilar(origin, candidates);
      const top = hits.slice(0, limit);
      // работы — только при включённом «Учёт времени», как в get_ticket
      const works = top.length && context.modules.timeTracking
        ? await source.loadWorkDescriptions(top.map((hit) => hit.ticket._id))
        : new Map();

      const scopeLabel = sameCompany ? `same company: ${ctx.directory.companies.get(String(origin.company._id))?.alias || origin.company.alias}` : "all companies";
      logCall(caller, "find_similar_tickets", { num, scope: scopeLabel, results: hits.length }, started);

      const header = `Similar to #${origin.num} «${oneLine(maskText(origin.title))}» (${ticketLink(baseUrl, origin.num)}; ${scopeLabel}; ${status === "closed" ? "closed tickets" : "any status"}): found ${hits.length}${top.length ? `; showing ${top.length}, best match first` : ""}.`;
      if (!top.length) return textResult(`${header}\nNo similar tickets. Try scope "all" or search_tickets with other words.`);
      const rows = top.map((hit, i) => {
        const closing = String(hit.ticket.closingComment || "").trim();
        const solved = {
          closing: closing.length >= MEANINGFUL_CLOSING ? closing : null,
          works: (works.get(String(hit.ticket._id)) || []).filter(Boolean).join(" / ") || null,
        };
        return formatTicketRow({ ...hit, needles, solved }, i + 1, ctx);
      });
      return textResult([header, ...rows].join("\n\n"));
    },

    stats: async (args = {}, caller, context) => {
      const started = Date.now();
      const { raw, directory } = await loadDirectoryContext(context);
      const names = resolveNames(raw, directory, args);
      if (names.error) {
        logCall(caller, "ticket_stats", { error: "name" }, started);
        return errorResult(names.error);
      }
      const groupBy = ["category", "month", "company", "applicant", "source"].includes(args.groupBy) ? args.groupBy : "category";
      const status = ["open", "closed", "any"].includes(args.status) ? args.status : "any";

      let filter;
      try {
        filter = buildTicketFilter({ status, ...names.ids, from: args.from, to: args.to, timezone: context.timezone });
      } catch (error) {
        logCall(caller, "ticket_stats", { error: "date" }, started);
        return errorResult(error.message);
      }

      const rows = await source.loadStatsRows(filter);
      const labelOf = (kind, key) => {
        if (kind === "category") return directory.categories.get(key) || "без категории";
        if (kind === "company") return directory.companies.get(key)?.alias || "без компании";
        if (kind === "applicant") return personLabel(key, { directory, systemAccounts: context.systemAccounts });
        return key || "—";
      };
      const stats = aggregateTicketStats(rows, { groupBy, timezone: context.timezone, labelOf });
      const summary = [`status: ${status}`, ...names.labels, periodLabel(args.from, args.to)].filter(Boolean).join("; ");
      logCall(caller, "ticket_stats", { groupBy, filters: summary, results: stats.total }, started);
      return textResult(formatStats(stats, { groupBy, summary }));
    },
  };
};

module.exports = { createTicketTools };
