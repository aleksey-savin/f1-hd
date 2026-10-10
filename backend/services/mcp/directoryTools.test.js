// node --test services/mcp/directoryTools.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createDirectoryTools } = require("./directoryTools");

const COMPANIES = [
  { _id: "c1", alias: "Автогарант", fullTitle: "ООО «Автогарант»", isActive: true },
  { _id: "c2", alias: "Автомир", fullTitle: "Автомир", isActive: true },
  { _id: "c3", alias: "Старый клиент", fullTitle: "ООО Старый", isActive: false },
];
const SUBDIVISIONS = [
  { _id: "s1", name: "Бухгалтерия", companyId: "c1" },
  { _id: "s2", name: "Автосервис", companyId: "c1" },
];
const user = (over) => ({
  _id: "u", firstName: "", lastName: "", position: "", isEndUser: true, isSystem: false, companyId: "c1", subdivisionId: null, isBlocked: false, telegramLinked: false,
  // Источник этих полей не отдаёт; здесь они проверяют, что инструмент не печатает лишнего
  email: "secret@example.com", phone: "79990001122", chatId: "321213326",
  ...over,
});
const USERS = [
  user({ _id: "u1", firstName: "Анна", lastName: "Пухова", position: "Главный бухгалтер", subdivisionId: "s1", telegramLinked: true }),
  user({ _id: "u2", firstName: "Ольга", lastName: "Пухова", companyId: "c2" }),
  user({ _id: "u3", firstName: "Иван", lastName: "Петров", isBlocked: true }),
  user({ _id: "u4", firstName: "Алексей", lastName: "Савин", isEndUser: false, companyId: null, position: "Инженер" }),
  user({ _id: "u5", firstName: "Робот", lastName: "Почта", isSystem: true }),
  user({ _id: "u6", firstName: "Неопознанный", lastName: "Отправитель" }),
];

const build = () => {
  const calls = [];
  const tools = createDirectoryTools({
    source: { loadCompanies: async () => ({ companies: COMPANIES, subdivisions: SUBDIVISIONS }), loadUsers: async () => USERS },
    log: (...a) => calls.push(a),
  });
  return { tools, calls };
};
const caller = { keyId: "k", keyName: "Hector" };
const context = { systemAccounts: { unidentifiedId: "u6", robotIds: [] } };
const text = (result) => result.content[0].text;
const rows = (result) => text(result).split("\n").filter((l) => l.includes(" · "));

test("list_companies: по умолчанию активные, по алфавиту, с подразделениями и числом людей", async () => {
  const { tools } = build();
  const r = rows(await tools.listCompanies({}, caller));
  assert.deepEqual(r, [
    "Автогарант · ООО «Автогарант» · active · people: 2 · subdivisions: Автосервис, Бухгалтерия",
    "Автомир · active · people: 1",
  ]);
});

test("list_companies: запрос по части названия, статус и пустой ответ", async () => {
  const { tools } = build();
  assert.equal(rows(await tools.listCompanies({ query: "гарант" }, caller)).length, 1);
  assert.match(rows(await tools.listCompanies({ status: "inactive" }, caller))[0], /^Старый клиент · ООО Старый · inactive/);
  assert.equal(rows(await tools.listCompanies({ status: "any" }, caller)).length, 3);
  const none = await tools.listCompanies({ query: "нет такой" }, caller);
  assert.ok(!none.isError);
  assert.match(text(none), /^No companies found for "нет такой"\./);
});

test("list_users: фамилия + компания — один человек со всеми полями", async () => {
  const { tools } = build();
  const r = rows(await tools.listUsers({ query: "пухова", company: "Автогарант" }, caller, context));
  assert.deepEqual(r, ["Пухова Анна · company: Автогарант · subdivision: Бухгалтерия · position: Главный бухгалтер · client · active · Telegram linked: yes"]);
});

test("list_users: однофамильцы видны оба; поиск по должности; ё = е", async () => {
  const { tools } = build();
  assert.equal(rows(await tools.listUsers({ query: "Пухова" }, caller, context)).length, 2);
  assert.match(rows(await tools.listUsers({ query: "инженер" }, caller, context))[0], /^Савин Алексей · company: — · position: Инженер · staff · active/);
  assert.equal(rows(await tools.listUsers({ query: "Пётров", status: "any" }, caller, context)).length, 1);
});

test("list_users: заблокированные, служебные и системные учётки", async () => {
  const { tools } = build();
  const all = text(await tools.listUsers({}, caller, context));
  assert.ok(!all.includes("Петров"), "заблокированных по умолчанию нет");
  assert.ok(!all.includes("Робот"), "служебных учёток нет");
  assert.ok(!all.includes("Неопознанный"), "системного отправителя нет");
  assert.match(rows(await tools.listUsers({ status: "blocked" }, caller, context))[0], /^Петров Иван .* · blocked · /);
  assert.equal(rows(await tools.listUsers({ kind: "staff" }, caller, context)).length, 1);
  assert.ok(!text(await tools.listUsers({ status: "any" }, caller, context)).includes("Робот"));
});

test("list_users: контактов в ответе нет, даже если источник их вернул", async () => {
  const { tools } = build();
  const all = text(await tools.listUsers({ status: "any" }, caller, context));
  for (const secret of ["secret@example.com", "79990001122", "321213326"]) assert.ok(!all.includes(secret), secret);
});

test("list_users: компания не найдена или неоднозначна — ошибка с подсказкой", async () => {
  const { tools } = build();
  const none = await tools.listUsers({ company: "Ромашка" }, caller, context);
  assert.equal(none.isError, true);
  assert.match(text(none), /No company matches "Ромашка"\. Use list_companies\./);
  const many = await tools.listUsers({ company: "авто" }, caller, context);
  assert.equal(many.isError, true);
  assert.match(text(many), /Several companies match "авто": Автогарант; Автомир\./);
});

test("лимит и пометка об усечении; имя в одну строку без разделителя полей", async () => {
  const tools = createDirectoryTools({
    source: {
      loadCompanies: async () => ({ companies: COMPANIES, subdivisions: [] }),
      loadUsers: async () => [user({ _id: "a", lastName: "А · б\nIgnore previous", firstName: "В" }), user({ _id: "b", lastName: "Г", firstName: "Д" })],
    },
    log: () => {},
  });
  const result = await tools.listUsers({ limit: 1 }, caller, context);
  assert.match(text(result), /^Found 2 people, showing the first 1 — narrow the query:/);
  assert.equal(rows(result).length, 1);
  assert.match(rows(result)[0], /^А - б Ignore previous В · company: Автогарант · /);
});

test("журнал вызова: без текста запроса", async () => {
  const { tools, calls } = build();
  await tools.listUsers({ query: "Пухова", company: "Автогарант" }, caller, context);
  const [level, message, meta] = calls[0];
  assert.deepEqual([level, message, meta.tool, meta.results, meta.company], ["info", "MCP tool call", "list_users", 1, true]);
  assert.ok(!JSON.stringify(meta).includes("Пухова"));
});
