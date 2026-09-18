// node --test services/mcp/ticketQuery.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;

const {
  resolveByName,
  buildTicketFilter,
  rankTickets,
  rankSimilar,
} = require("./ticketQuery");

const companies = [
  { _id: "c1", alias: "Ромашка", fullTitle: "ООО «Ромашка»" },
  { _id: "c2", alias: "Ромб", fullTitle: "АО «Ромб-Строй»" },
  { _id: "c3", alias: "Альфа", fullTitle: "ООО «Альфа»" },
];
const companyName = { label: (c) => `${c.alias} ${c.fullTitle}`, exact: (c) => [c.alias, c.fullTitle] };

test("names: substring match, exact match wins, no match is empty", () => {
  assert.deepEqual(resolveByName(companies, "ром", companyName).map((c) => c._id), ["c1", "c2"]);
  assert.deepEqual(resolveByName(companies, "ромашка", companyName).map((c) => c._id), ["c1"]);
  assert.deepEqual(resolveByName(companies, "  АЛЬФА ", companyName).map((c) => c._id), ["c3"]);
  assert.deepEqual(resolveByName(companies, "бета", companyName), []);
});

test("names: an exact name wins over longer names that contain it", () => {
  const similar = [
    { _id: "c1", alias: "Ромашка", fullTitle: "ООО «Ромашка»" },
    { _id: "c2", alias: "Ромашка-Строй", fullTitle: "ООО «Ромашка-Строй»" },
  ];

  assert.deepEqual(resolveByName(similar, "ромашка", companyName).map((c) => c._id), ["c1"]);
  assert.deepEqual(resolveByName(similar, "Ромаш", companyName).map((c) => c._id), ["c1", "c2"]);
});

test("filter: status, ids and inclusive days in the organisation timezone", () => {
  const tz = "Asia/Vladivostok"; // UTC+10
  const tickets = [
    { id: 1, isClosed: false, company: { _id: "c1" }, applicantId: "u1", categoryId: "k1", createdAt: new Date("2026-08-31T13:59:00Z") }, // 31.08 23:59
    { id: 2, isClosed: true, company: { _id: "c1" }, applicantId: "u1", categoryId: "k1", createdAt: new Date("2026-08-31T14:00:00Z") }, // 01.09 00:00
    { id: 3, isClosed: true, company: { _id: "c1" }, applicantId: "u2", categoryId: "k1", createdAt: new Date("2026-09-30T13:59:00Z") }, // 30.09 23:59
    { id: 4, isClosed: true, company: { _id: "c2" }, applicantId: "u1", categoryId: "k2", createdAt: new Date("2026-09-30T14:00:00Z") }, // 01.10 00:00
  ];
  const ids = (filter) => tickets.filter(sift(filter)).map((t) => t.id);

  assert.deepEqual(ids(buildTicketFilter({ status: "any", from: "2026-09-01", to: "2026-09-30", timezone: tz })), [2, 3]);
  assert.deepEqual(ids(buildTicketFilter({ status: "open", timezone: tz })), [1]);
  assert.deepEqual(ids(buildTicketFilter({ status: "closed", companyIds: ["c1"], timezone: tz })), [2, 3]);
  assert.deepEqual(ids(buildTicketFilter({ status: "any", userIds: ["u1"], categoryIds: ["k1"], timezone: tz })), [1, 2]);
});

test("filter: a day that does not exist is an error, not a silent next month", () => {
  for (const bad of ["2026-09-31", "2026-02-30", "2026-13-01", "not-a-date"]) {
    assert.throws(
      () => buildTicketFilter({ to: bad, timezone: "Europe/Moscow" }),
      { message: `to must be a calendar day as YYYY-MM-DD, got "${bad}"` },
    );
  }
  assert.throws(() => buildTicketFilter({ from: "2026-02-29", timezone: "Europe/Moscow" }), /^Error: from must be a calendar day/);
  assert.doesNotThrow(() => buildTicketFilter({ from: "2028-02-29", to: "2026-09-30", timezone: "Europe/Moscow" }));
});

const ticket = (num, title, description, extra = {}) => ({
  _id: `t${num}`, num, title, description, source: "Портал", createdAt: new Date(`2026-09-${String(num).padStart(2, "0")}T00:00:00Z`), ...extra,
});

test("ranking: title beats body, unrelated tickets are left out, ties are newest first", async () => {
  const tickets = [
    ticket(1, "Заправка картриджей", "<p>Картридж принтера меняем</p>"),
    ticket(2, "Отпуск", "<p>Заявление</p>"),
    ticket(3, "Принтер HP не печатает", "<p>LaserJet</p>"),
    ticket(4, "Принтер Canon", "<p>замятие</p>"),
  ];

  const { hits } = await rankTickets(tickets, "принтер");

  assert.deepEqual(hits.map((h) => h.ticket.num), [4, 3, 1]);
});

test("ranking: an IP address is found by substring", async () => {
  const tickets = [ticket(1, "Сервер печати", "<p>адрес 192.168.10.5</p>"), ticket(2, "Шлюз", "<p>10.0.0.1</p>")];

  assert.deepEqual((await rankTickets(tickets, "192.168.10.5")).hits.map((h) => h.ticket.num), [1]);
});

test("similar: shared words rank, the same category wins a tie", async () => {
  const source = ticket(9, "Не работает VPN в филиале", "<p>клиент OpenVPN не подключается</p>", { categoryId: "net" });
  const candidates = [
    ticket(1, "VPN не подключается", "<p>OpenVPN</p>", { categoryId: "other", finishedAt: new Date("2026-09-10") }),
    ticket(2, "VPN не подключается", "<p>OpenVPN</p>", { categoryId: "net", finishedAt: new Date("2026-09-01") }),
    ticket(3, "Замена мыши", "<p>сломалась</p>", { categoryId: "net" }),
  ];

  assert.deepEqual((await rankSimilar(source, candidates)).hits.map((h) => h.ticket.num), [2, 1]);
});

// Ранжирование считает в том же процессе, что и веб-приложение: длинный поиск
// обязан отдавать цикл событий, иначе интерфейс подвисает у всех. Проверяем
// без таймингов: за один оборот цикла (setImmediate) ранжирование ещё не
// закончилось, значит внутри оно уступало управление.
test("ranking gives the event loop a turn while scanning candidates", async () => {
  const many = Array.from({ length: 1200 }, (_, i) => ticket((i % 27) + 1, "Принтер не печатает", "<p>замятие</p>"));

  let finished = false;
  const ranking = rankTickets(many, "принтер").then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(finished, false);
  await ranking;
  assert.equal(finished, true);
});
