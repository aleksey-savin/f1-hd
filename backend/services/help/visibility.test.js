// node --test services/help/visibility.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { audiencesFor, visibleSections, hasHelp, findSection, findArticle } = require("./visibility");

const art = (slug) => ({ slug, title: slug, summary: "", body: "" });
const SECTIONS = [
  { audience: "client", key: "tickets", title: "Заявки", articles: [art("new")] },
  { audience: "client", key: "devices", title: "Устройства", modules: ["inventory"], articles: [art("mine")] },
  { audience: "client", key: "account", title: "Аккаунт", articles: [] },
  { audience: "staff", key: "tickets", title: "Заявки", articles: [art("queues")] },
  { audience: "staff", key: "reports", title: "Отчёты", modules: ["timeTracking", "finances"], articles: [art("my")] },
];
const client = { isEndUser: true, modules: {} };
const staff = { isEndUser: false, modules: { finances: { isActive: true } } };

test("аудитории читателя", () => {
  assert.deepEqual(audiencesFor(true), ["client"]);
  assert.deepEqual(audiencesFor(false), ["staff", "client"]);
});

test("клиент не получает сотруднических разделов, пустые и выключенные скрыты", () => {
  assert.deepEqual(
    visibleSections(SECTIONS, client).map((s) => `${s.audience}/${s.key}`),
    ["client/tickets"],
  );
});

test("сотрудник видит обе части; раздел с несколькими модулями открыт одним из них", () => {
  assert.deepEqual(
    visibleSections(SECTIONS, staff).map((s) => `${s.audience}/${s.key}`),
    ["client/tickets", "staff/tickets", "staff/reports"],
  );
});

test("hasHelp", () => {
  assert.equal(hasHelp(SECTIONS, client), true);
  assert.equal(hasHelp([SECTIONS[2], SECTIONS[3]], client), false);
  assert.equal(hasHelp([], staff), false);
});

test("findArticle: чужая аудитория, скрытый модуль, негодные имена — null", () => {
  assert.equal(findArticle(SECTIONS, staff, "staff", "tickets", "queues").article.slug, "queues");
  assert.equal(findArticle(SECTIONS, staff, "client", "tickets", "new").section.title, "Заявки");
  assert.equal(findArticle(SECTIONS, client, "staff", "tickets", "queues"), null);
  assert.equal(findArticle(SECTIONS, client, "client", "devices", "mine"), null);
  assert.equal(findArticle(SECTIONS, staff, "staff", "tickets", "nope"), null);
  assert.equal(findArticle(SECTIONS, staff, "staff", "..", "queues"), null);
  assert.equal(findArticle(SECTIONS, staff, "admin", "tickets", "queues"), null);
  assert.equal(findArticle(SECTIONS, staff, undefined, undefined, undefined), null);
});

test("findSection отдаёт только видимый раздел", () => {
  assert.equal(findSection(SECTIONS, staff, "staff", "tickets").key, "tickets");
  assert.equal(findSection(SECTIONS, client, "staff", "tickets"), null);
  assert.equal(findSection(SECTIONS, client, "client", "account"), null);
});
