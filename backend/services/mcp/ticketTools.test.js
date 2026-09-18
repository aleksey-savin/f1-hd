// node --test services/mcp/ticketTools.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;

const { createTicketTools } = require("./ticketTools");

const companies = [
  { _id: "c1", alias: "Ромашка", fullTitle: "ООО «Ромашка»" },
  { _id: "c2", alias: "Ромб", fullTitle: "АО «Ромб»" },
];
const users = [
  { _id: "u1", firstName: "Мария", lastName: "Иванова", position: "бухгалтер", isEndUser: true, company: { _id: "c1" } },
  { _id: "u2", firstName: "Иван", lastName: "Иванов", position: "директор", isEndUser: true, company: { _id: "c2" } },
];
const categories = [{ _id: "k1", title: "Оргтехника" }, { _id: "k2", title: "Сеть" }];

const t = (num, over) => ({
  _id: `t${num}`, num, title: `Заявка ${num}`, description: "", source: "Портал", state: "Закрыта", isClosed: true,
  categoryId: "k1", company: { _id: "c1", alias: "Ромашка" }, applicantId: "u1",
  createdAt: new Date(`2026-09-${String(num % 28 + 1).padStart(2, "0")}T03:00:00Z`),
  finishedAt: new Date(`2026-09-${String(num % 28 + 1).padStart(2, "0")}T06:00:00Z`),
  closingComment: "", ...over,
});

const tickets = [
  t(1, { title: "Не печатает принтер HP", description: "<p>замятие бумаги</p>", closingComment: "Почистили ролики подачи бумаги, заменили тормозную площадку, напечатали тестовую страницу — работает стабильно." }),
  t(2, { title: "Принтер HP снова не печатает", description: "<p>опять замятие</p>" }),
  t(3, { title: "VPN не подключается", categoryId: "k2", isClosed: false, state: "В работе", finishedAt: null }),
  t(4, { title: "Принтер Canon", description: "<p>модель LBP 2900</p>", company: { _id: "c2", alias: "Ромб" }, applicantId: "u2" }),
];

const fakeSource = () => ({
  loadDirectory: async () => ({ companies, users, categories }),
  findTickets: async (filter, { sort = { createdAt: -1 }, skip = 0, limit = 1000 } = {}) => {
    const [[field, order]] = Object.entries(sort);
    return tickets
      .filter(sift(filter))
      .sort((a, b) => (new Date(a[field]) - new Date(b[field])) * order)
      .slice(skip, skip + limit);
  },
  countTickets: async (filter) => tickets.filter(sift(filter)).length,
  loadTicketDetail: async (num, { works, devices }) => {
    const ticket = tickets.find((item) => item.num === num);
    if (!ticket) return null;
    return {
      ticket,
      routineTaskTitle: null,
      comments: [{ content: "Проверьте, пожалуйста", createdBy: "u1", createdAt: ticket.createdAt }],
      works: works ? [{ description: "Почистил ролики", visitRequired: true, startedAt: ticket.createdAt, finishedAt: ticket.finishedAt, durationMs: 3 * 3_600_000, finishedBy: { _id: "x", firstName: "Пётр", lastName: "Петров" } }] : null,
      devices: devices ? [] : null,
    };
  },
  loadWorkDescriptions: async (ids) => new Map(ids.map((id) => [String(id), ["Почистил ролики"]])),
  loadStatsRows: async (filter) => tickets.filter(sift(filter)),
});

const context = { timezone: "Asia/Vladivostok", modules: { timeTracking: true, inventory: false }, systemAccounts: { unidentifiedId: null, robotIds: [] } };
const caller = { keyId: "k", keyName: "OpenClaw" };

const setup = () => {
  const logs = [];
  const tools = createTicketTools({ source: fakeSource(), baseUrl: "https://hd.example.ru", log: (level, message, meta) => logs.push(meta) });
  return { tools, logs };
};

const text = (result) => result.content.map((part) => part.text).join("\n");
const nums = (result) => [...text(result).matchAll(/tickets\/(\d+)/g)].map((m) => Number(m[1]));

test("search: words rank inside the chosen company and status", async () => {
  const { tools } = setup();

  const result = await tools.search({ query: "принтер", company: "Ромашка", status: "closed" }, caller, context);

  assert.ok(!result.isError);
  assert.deepEqual(nums(result), [2, 1]);
  assert.match(text(result), /Found 2 tickets/);
});

test("search: without words — newest first, with the total", async () => {
  const { tools } = setup();

  const result = await tools.search({ status: "any", limit: 2 }, caller, context);

  assert.match(text(result), /Found 4 tickets/);
  assert.equal(nums(result).length, 2);
});

test("search: an ambiguous company name is a tool error listing the options", async () => {
  const { tools } = setup();

  const result = await tools.search({ company: "Ром" }, caller, context);

  assert.equal(result.isError, true);
  assert.match(text(result), /Ромашка/);
  assert.match(text(result), /Ромб/);
});

test("search: a ticket number finds that ticket", async () => {
  const { tools } = setup();

  assert.deepEqual(nums(await tools.search({ query: "3" }, caller, context)), [3]);
});

test("search: a number also finds tickets that mention it", async () => {
  const { tools } = setup();

  assert.deepEqual(nums(await tools.search({ query: "2900" }, caller, context)), [4]);
});

test("get_ticket: works follow the time-tracking module", async () => {
  const { tools } = setup();

  const withWorks = text(await tools.getTicket({ num: 1 }, caller, context));
  const withoutWorks = text(await tools.getTicket({ num: 1 }, caller, { ...context, modules: { timeTracking: false, inventory: false } }));

  assert.match(withWorks, /## Works \(1\)/);
  assert.doesNotMatch(withoutWorks, /## Works/);
  assert.equal((await tools.getTicket({ num: 999 }, caller, context)).isError, true);
});

test("find_similar_tickets: same company, closed by default, with how it was solved", async () => {
  const { tools } = setup();

  const result = await tools.findSimilar({ num: 2 }, caller, context);

  assert.deepEqual(nums(result).slice(1), [1]); // первая ссылка — на исходную заявку в заголовке
  assert.match(text(result), /solved: Почистили ролики подачи бумаги/);
  assert.match(text(result), /works: Почистил ролики/);
});

test("find_similar_tickets: work descriptions follow the time-tracking module", async () => {
  const { tools } = setup();

  const result = text(await tools.findSimilar({ num: 2 }, caller, { ...context, modules: { timeTracking: false, inventory: false } }));

  assert.match(result, /solved: Почистили ролики подачи бумаги/);
  assert.doesNotMatch(result, /works: /);
});

test("ticket_stats: grouped by category with names", async () => {
  const { tools } = setup();

  const result = await tools.stats({ groupBy: "category" }, caller, context);

  assert.match(text(result), /Tickets: 4 \(open 1, closed 3\)/);
  assert.match(text(result), /\| Оргтехника \| 3 \|/);
  assert.match(text(result), /\| Сеть \| 1 \|/);
});

test("search and stats: a day that does not exist is a tool error with a log line", async () => {
  const { tools, logs } = setup();

  const search = await tools.search({ to: "2026-09-31" }, caller, context);
  const stats = await tools.stats({ from: "2026-02-30" }, caller, context);

  assert.equal(search.isError, true);
  assert.match(text(search), /to must be a calendar day as YYYY-MM-DD, got "2026-09-31"/);
  assert.equal(stats.isError, true);
  assert.deepEqual(logs.map((meta) => [meta.tool, meta.error]), [["search_tickets", "date"], ["ticket_stats", "date"]]);
});

test("every call writes one log line naming the key and the tool", async () => {
  const { tools, logs } = setup();

  await tools.search({ query: "vpn" }, caller, context);
  await tools.stats({}, caller, context);

  assert.deepEqual(logs.map((meta) => [meta.mcpKeyName, meta.tool]), [["OpenClaw", "search_tickets"], ["OpenClaw", "ticket_stats"]]);
});

test("search: a page past the last one says so instead of an empty range", async () => {
  const { tools, logs } = setup();

  const result = await tools.search({ status: "any", limit: 2, page: 5 }, caller, context);

  assert.ok(!result.isError);
  assert.match(text(result), /No tickets on page 5 \(4 found\)\. Ask for an earlier page\./);
  assert.doesNotMatch(text(result), /showing/);
  assert.deepEqual(logs.map((meta) => [meta.tool, meta.results]), [["search_tickets", 4]]);
});

// Ранжируются только MAX_CANDIDATES самых свежих заявок: когда потолок упёрся,
// агент должен видеть, что «Found N» — это не весь архив.
test("search: the header says so when the candidate cap binds", async () => {
  const many = Array.from({ length: 20_000 }, (_, i) => t(i + 1, { num: i + 1, title: "Не печатает принтер" }));
  const { logs } = setup();
  const tools = createTicketTools({
    source: { ...fakeSource(), findTickets: async () => many },
    baseUrl: "https://hd.example.ru",
    log: (level, message, meta) => logs.push(meta),
  });

  const result = await tools.search({ query: "принтер", limit: 1 }, caller, context);

  assert.match(text(result), /ranked the newest 20,000 tickets only/);
});
