const { formatAnswer } = require("../ticketQuestionnaire");
const { maskText } = require("./maskText");
const { iso, buildSnippet, ticketPlainText } = require("./text");

/**
 * Текст заявок для ИИ-агента. Сюда попадает только разрешённое (spec
 * 2026-09-17-mcp-tickets-design.md): поля перечислены явно, каждый свободный
 * текст — через maskText. Даже если источник принёс лишнее (htmlDescription,
 * контакты ответственных, вложения, IP техники), в вывод оно не попадает.
 */

const MAX_DESCRIPTION = 20_000;
const MAX_COMMENT = 4_000;
const MAX_SOLVED = 600;

const clip = (text, max) =>
  text.length <= max ? text : `${text.slice(0, max)}\n[…truncated: ${text.length - max} more characters — open the link]`;

const safe = (value, max) => clip(maskText(value), max);

// Чужой текст — данные, а не указания: каждая строка начинается с «> », чтобы
// подделка вида «## Comments (3)» не выглядела разделом ответа.
const quote = (text) => String(text).split("\n").map((line) => `> ${line}`).join("\n");

// Заголовки, ответы анкеты и пункты чек-листа живут одной строкой списка:
// переносы из чужого текста схлопываем, иначе подделка вылезает в начало
// строки (тема письма и заголовок из API — такой же чужой текст).
const oneLine = (text) => String(text).replace(/\s+/g, " ").trim();

const byId = (items, pick) => new Map(items.map((item) => [String(item._id), pick(item)]));

const buildDirectory = ({ companies, users, categories }) => ({
  companies: byId(companies, (c) => ({ alias: c.alias, fullTitle: c.fullTitle })),
  users: byId(users, (u) => u),
  categories: byId(categories, (c) => c.title),
});

const nameOf = (user) => [user?.lastName, user?.firstName].filter(Boolean).join(" ") || "—";

const isSystemUser = (id, directory, systemAccounts) => {
  const key = String(id || "");
  const user = directory.users.get(key);
  return (
    key === String(systemAccounts.unidentifiedId || "") ||
    systemAccounts.robotIds.includes(key) ||
    Boolean(user?.isServiceAccount || user?.isCloudTelephony)
  );
};

const personLabel = (id, { directory, systemAccounts }) => {
  if (!id) return "—";
  const key = String(id);
  if (key === String(systemAccounts.unidentifiedId || "")) return "unidentified e-mail sender (system)";
  const user = directory.users.get(key);
  if (!user) return "unknown person";
  if (isSystemUser(key, directory, systemAccounts)) return `${nameOf(user)} (system)`;
  const position = user.position ? `, ${user.position}` : "";
  return `${nameOf(user)}${position} (${user.isEndUser === false ? "staff" : "client"})`;
};

const companyLabel = (company, directory) =>
  directory.companies.get(String(company?._id || ""))?.alias || company?.alias || "—";

const categoryLabel = (id, directory) => directory.categories.get(String(id || "")) || "—";

const ticketLink = (baseUrl, num) => `${String(baseUrl || "").replace(/\/+$/, "")}/tickets/${num}`;

const statusLabel = (ticket) => `${ticket.isClosed ? "closed" : "open"} (${ticket.state || "—"})`;

const formatTicketRow = (entry, index, ctx) => {
  const { ticket } = entry;
  const lines = [
    `${index}. #${ticket.num} · ${oneLine(maskText(ticket.title))}`,
    `status: ${statusLabel(ticket)}; company: ${companyLabel(ticket.company, ctx.directory)}; applicant: ${personLabel(ticket.applicantId, ctx)}; category: ${categoryLabel(ticket.categoryId, ctx.directory)}`,
    `created: ${iso(ticket.createdAt)}; closed: ${ticket.isClosed ? iso(ticket.finishedAt) : "—"}`,
    `link: ${ticketLink(ctx.baseUrl, ticket.num)}`,
  ];
  if (entry.text != null) {
    // Маска — до нарезки окна: окно снипета может начаться внутри телефона и
    // оставить нераспознанный хвост цифр (контроллер, task-6 ruling).
    lines.push(`snippet: ${buildSnippet(maskText(entry.text), entry.needles || []) || "—"}`);
  }
  if (entry.solved) {
    // «Как решили» — тоже по строке на поле: переносы схлопываем, иначе чужой
    // текст выходит из строки результата
    if (entry.solved.closing) lines.push(`solved: ${oneLine(safe(entry.solved.closing, MAX_SOLVED))}`);
    if (entry.solved.works) lines.push(`works: ${oneLine(safe(entry.solved.works, MAX_SOLVED))}`);
  }
  return lines.join("\n   ");
};

const formatTicketDetail = (detail, ctx) => {
  const { ticket } = detail;
  const directory = ctx.directory;
  const company = directory.companies.get(String(ticket.company?._id || ""));
  const out = [
    `# #${ticket.num} · ${oneLine(maskText(ticket.title))}`,
    `status: ${statusLabel(ticket)}; source: ${ticket.source || "—"}; category: ${categoryLabel(ticket.categoryId, directory)}`,
    `company: ${companyLabel(ticket.company, directory)}${company?.fullTitle ? ` (${company.fullTitle})` : ""}`,
    `applicant: ${personLabel(ticket.applicantId, ctx)}`,
    `responsibles: ${(ticket.responsibles || []).map((r) => nameOf(r)).join(", ") || "—"}`,
  ];
  if (detail.routineTaskTitle) out.push(`routine task: ${maskText(detail.routineTaskTitle)}`);
  out.push(
    `created: ${iso(ticket.createdAt)}; processed: ${iso(ticket.processedAt)}; started: ${iso(ticket.startedAt)}; closed: ${ticket.isClosed ? iso(ticket.finishedAt) : "—"}; deadline: ${iso(ticket.deadline)}`,
    `link: ${ticketLink(ctx.baseUrl, ticket.num)}`,
    "",
    "## Description",
    quote(safe(ticketPlainText(ticket), MAX_DESCRIPTION) || "(empty)"),
  );

  const answers = (ticket.customFields || [])
    .map((field) => ({ name: field.name, answer: formatAnswer(field) }))
    .filter((item) => item.answer);
  if (answers.length) {
    out.push("", "## Questionnaire", ...answers.map((item) => `- ${oneLine(maskText(item.name))}: ${oneLine(maskText(item.answer))}`));
  }

  const checklist = ticket.checklist || [];
  if (checklist.length) {
    out.push("", "## Checklist", ...checklist.map((item) => `- [${item.checked ? "x" : " "}] ${oneLine(maskText(item.description))}`));
  }

  out.push("", `## Comments (${detail.comments.length})`);
  for (const comment of detail.comments) {
    out.push(
      `- ${iso(comment.createdAt)} · ${personLabel(comment.createdBy, ctx)}:`,
      quote(safe(comment.content, MAX_COMMENT) || "(empty)"),
    );
  }

  if (detail.works) {
    out.push("", `## Works (${detail.works.length})`);
    for (const work of detail.works) {
      const performer = nameOf(work.finishedBy?._id ? work.finishedBy : work.executor);
      const minutes = Math.round((work.durationMs || 0) / 60_000);
      out.push(
        `- ${iso(work.startedAt)} → ${iso(work.finishedAt)} (${minutes} min, ${work.visitRequired ? "on-site" : "remote"}) · ${performer}:`,
        quote(safe(work.description, MAX_COMMENT) || "(empty)"),
      );
    }
  }

  if (detail.devices) {
    out.push("", `## Devices (${detail.devices.length})`);
    for (const device of detail.devices) {
      const model = device.deviceModelId;
      const type = model?.deviceTypeId?.name || device.deviceTypeId?.name || "device";
      const name = [model?.vendorId?.name, model?.name].filter(Boolean).join(" ") || "—";
      out.push(
        `- ${type} · ${name} · inv. ${device.inventoryNumber || "—"} · s/n ${device.serialNumber || "—"} · ${device.status || "—"} · OS: ${device.operatingSystem || "—"}`,
      );
    }
  }

  return out.join("\n");
};

const formatStats = (stats, { groupBy, summary }) => {
  const header = `Tickets: ${stats.total} (open ${stats.open}, closed ${stats.closed}), grouped by ${groupBy}${summary ? ` (${summary})` : ""}.`;
  if (!stats.total) return `${header}\nNo tickets match.`;
  const rows = stats.groups.map(
    (g) => `| ${g.label} | ${g.tickets} | ${g.open} | ${g.closed} | ${g.medianHours ?? "—"} | ${g.share}% |`,
  );
  return [header, "", `| ${groupBy} | tickets | open | closed | median hours to close | share |`, "|---|---|---|---|---|---|", ...rows].join("\n");
};

module.exports = {
  oneLine,
  buildDirectory,
  isSystemUser,
  personLabel,
  companyLabel,
  categoryLabel,
  ticketLink,
  formatTicketRow,
  formatTicketDetail,
  formatStats,
};
