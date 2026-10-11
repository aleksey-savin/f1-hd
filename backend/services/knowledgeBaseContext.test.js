// node --test services/knowledgeBaseContext.test.js
require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const KnowledgeNote = require("@/models/knowledgeNote");
const { collectRelevantNotes } = require("./knowledgeBaseContext");

// В ИИ-контекст заявки едут только заметки, за которые отвечает человек:
// непроверенный черновик, заведённый ИИ-агентом по MCP, туда не попадает.
// Базы нет: запрос модели подменён, проверяется отбор уже в памяти.

const COMPANY = "64f000000000000000000001";
const AGENT = { keyId: "66aa000000000000000000aa" };

const note = (title, overrides = {}) => ({
  _id: title,
  title,
  type: "info",
  plainText: "Не открывается 1С на сервере",
  companies: [{ _id: COMPANY }],
  categories: [],
  users: [],
  approved: false,
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  ...overrides,
});

const realFind = KnowledgeNote.find;
afterEach(() => {
  KnowledgeNote.find = realFind;
});

const stubFind = (notes) => {
  const asked = {};
  KnowledgeNote.find = (filter) => {
    asked.filter = filter;
    return {
      select: (fields) => {
        asked.fields = fields;
        return { lean: async () => notes };
      },
    };
  };
  return asked;
};

test("collectRelevantNotes: непроверенный черновик агента в контекст заявки не едет", async () => {
  const asked = stubFind([
    note("Черновик агента", { agent: AGENT }),
    note("Проверенная заметка агента", { agent: AGENT, approved: true }),
    note("Непроверенная заметка человека"),
    note("Проверенная заметка человека", { approved: true }),
  ]);

  const titles = (await collectRelevantNotes({ companyId: COMPANY, title: "Не открывается 1С" })).map((item) => item.title).sort();

  assert.deepEqual(titles, ["Непроверенная заметка человека", "Проверенная заметка агента", "Проверенная заметка человека"]);
  // Поля, по которым идёт отбор, обязаны быть в выборке
  assert.match(asked.fields, /\bapproved\b/);
  assert.match(asked.fields, /\bagent\b/);
});

test("collectRelevantNotes: один черновик агента — пустой контекст, а не запасной порядок", async () => {
  stubFind([note("Черновик агента", { agent: AGENT, plainText: "Совсем о другом" })]);
  assert.deepEqual(await collectRelevantNotes({ companyId: COMPANY, title: "Не открывается 1С" }), []);
});
