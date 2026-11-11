require("module-alias/register");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { MongoClient, ObjectId } = require("mongodb");
const { conversationSearchPipeline, searchTerms } = require("./search");
const { listFilter } = require("./visibility");
const Module = require("node:module");
// Ticket model initializes a database counter at import; this test uses only
// the raw isolated fixture database and never boots application connections.
const ticketModule = require.resolve("@/models/ticket");
const ticketStub = new Module(ticketModule);
Object.assign(ticketStub, { loaded: true, exports: { Ticket: {} } });
require.cache[ticketModule] = ticketStub;

const ids = Object.fromEntries(
  [
    "me",
    "other",
    "company",
    "foreignCompany",
    "user",
    "staff",
    "identity",
    "groupIdentity",
    "legacy",
    "multiple",
    "history",
    "group",
    "hidden",
    "foreign",
    "assignedForeign",
    "open",
    "camera",
    "closed",
    "foreignTicket",
    "origin",
  ].map((key, index) => [
    key,
    new ObjectId((index + 1).toString(16).padStart(24, "0")),
  ]),
);
const auth = {
  userId: String(ids.me),
  isAdmin: false,
  isEndUser: false,
  can: (request) => Boolean(request.conversation?.includes("readAll") || request.ticket?.includes("readCompanies")),
  legacy: { responsibleForCompanies: [{ id: String(ids.company) }] },
};
const admin = { ...auth, isAdmin: true };
const ownScope = { ...auth,
  can: request => Boolean(request.conversation?.includes("read") || request.ticket?.includes("readAll")),
  messagingScope: { all: false, ticketIds: [ids.open, ids.camera, ids.closed], conversationIds: [ids.legacy, ids.multiple, ids.history] },
};
const local = process.env.HD_DIALOG_SEARCH_LOCAL === "1";
const uri = process.env.HD_DIALOG_SEARCH_MONGO_URI || (local ? "mongodb://127.0.0.1:27017/?authSource=admin" : null);
let client, db;

before(async () => {
  if (!uri) return;
  assert.match(
    uri,
    /^mongodb:\/\/(127\.0\.0\.1|localhost):/,
    "integration fixtures require an isolated local MongoDB",
  );
  const env = local ? require("node:util").parseEnv(require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../../.env"), "utf8")) : null;
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, ...(env ? { auth: { username: env.MONGODB_USERNAME, password: env.MONGODB_PASSWORD } } : {}) });
  await client.connect();
  db = client.db(`hd_dialog_search_${randomUUID().replaceAll("-", "")}`);
  await db.collection("companies").insertMany([
    { _id: ids.company, alias: "Вектор", fullTitle: "ООО Восточный вектор" },
    {
      _id: ids.foreignCompany,
      alias: "Чужая компания",
      fullTitle: "Недоступная организация",
    },
  ]);
  await db.collection("users").insertMany([
    {
      _id: ids.user,
      firstName: "Алексей",
      lastName: "Савин",
      phone: "79145550142",
      email: "a.savin@example.test",
      company: { _id: ids.company, alias: "Вектор" },
    },
    {
      _id: ids.staff,
      firstName: "Пётр",
      lastName: "Лебедев",
      phone: "79990000077",
      email: "private-staff@internal.test",
    },
  ]);
  await db.collection("channelidentities").insertMany([
    {
      _id: ids.identity,
      userId: ids.user,
      displayName: "Старый ник",
      username: "aleksey_savin",
      phone: "79145550142",
      email: "external@example.test",
    },
    {
      _id: ids.groupIdentity,
      userId: ids.staff,
      displayName: "Рабочий ник",
      username: "petr_worker",
      phone: "",
    },
  ]);
  const base = {
    companyId: ids.company,
    kind: "direct",
    network: "telegram",
    counterpartIdentityId: ids.identity,
    hidden: false,
    lastMessage: {
      at: new Date("2026-11-12T04:00:00Z"),
      preview: "Последний короткий ответ",
      authorName: "Сотрудник",
    },
  };
  await db.collection("conversations").insertMany([
    {
      ...base,
      _id: ids.legacy,
      title: "Устаревший заголовок",
      binding: { ticketId: ids.open, ticketNum: 58956 },
    },
    {
      ...base,
      _id: ids.multiple,
      title: "Камера",
      ticketBindings: [
        { ticketId: ids.camera, ticketNum: 58970, endedAt: null },
        { ticketId: ids.closed, ticketNum: 58842, endedAt: new Date() },
      ],
    },
    { ...base, _id: ids.history, title: "Старая история", ticketBindings: [] },
    {
      ...base,
      _id: ids.group,
      title: "Группа склада",
      kind: "group",
      counterpartIdentityId: null,
      participants: [{ identityId: ids.groupIdentity }],
    },
    { ...base, _id: ids.hidden, title: "Скрытая переписка", hidden: true },
    {
      ...base,
      _id: ids.foreign,
      title: "Чужой разговор",
      companyId: ids.foreignCompany,
      counterpartIdentityId: null,
    },
    {
      ...base,
      _id: ids.assignedForeign,
      title: "Доступный назначенный разговор",
      companyId: ids.foreignCompany,
      counterpartIdentityId: null,
      assigneeId: ids.me,
      ticketBindings: [{ ticketId: ids.foreignTicket, ticketNum: 59999 }],
    },
  ]);
  await db.collection("tickets").insertMany([
    {
      _id: ids.open,
      num: 58956,
      title: "Ремонт принтера",
      description: "Заменить фотобарабан",
      state: "В работе",
      company: { _id: ids.company },
    },
    {
      _id: ids.camera,
      num: 58970,
      title: "Замена камеры",
      description: "Купить видеонаблюдение",
      state: "Новая",
      company: { _id: ids.company },
    },
    {
      _id: ids.closed,
      num: 58842,
      title: "Удалённый доступ к 1С",
      description: "Установить WireGuard",
      isClosed: true,
      company: { _id: ids.company },
    },
    {
      _id: ids.foreignTicket,
      num: 59999,
      title: "Секретный бюджет",
      description: "Конфиденциальная смета",
      company: { _id: ids.foreignCompany },
    },
    {
      _id: ids.origin,
      num: 58700,
      title: "Офис на Набережной",
      description: "Подключить рабочие места",
      originConversationId: ids.group,
      company: { _id: ids.company },
    },
  ]);
  await db.collection("messages").insertMany([
    {
      conversationId: ids.legacy,
      direction: "in",
      text: "Когда приедет инженер? Тут уникальный старый текст про фотобарабан.",
      authorName: "Алексей",
      ticketId: ids.open,
      attachments: [{ originalName: "wireguard.conf" }],
    },
    {
      conversationId: ids.history,
      direction: "in",
      text: "Сеть подключилась",
      ticketId: ids.closed,
      attachments: [{ originalName: "Схема офиса.pdf" }],
    },
    {
      conversationId: ids.group,
      direction: "in",
      text: "Монтаж в четверг",
      authorName: "Пётр",
      attachments: [],
    },
    {
      conversationId: ids.foreign,
      direction: "in",
      text: "Уникальный старый текст про чужую компанию",
      attachments: [],
    },
    {
      conversationId: ids.history,
      direction: "in",
      text: "Удалённая фраза кракозябра",
      deletedAt: new Date(),
      attachments: [{ originalName: "удалённый-файл.conf" }],
    },
  ]);
  await db.collection("messages").createIndex({ conversationId: 1 });
});
after(async () => {
  if (db) await db.dropDatabase();
  if (client) await client.close();
});

const integration = { skip: !uri };
const search = async (
  query,
  { queue = "all", scope = auth, company, limit = 50 } = {},
) =>
  db
    .collection("conversations")
    .aggregate(
      conversationSearchPipeline({
        filter: listFilter(queue, scope, company ? { companyId: company } : {}),
        query,
        auth: scope,
        limit,
      }),
    )
    .toArray();
const names = (rows) => rows.map((row) => String(row._id));
const expectIds = async (query, expected, options) =>
  assert.deepEqual(
    names(await search(query, options)).sort(),
    expected.map((key) => String(ids[key])).sort(),
    query,
  );

test("query input is bounded, joins ticket prefixes and treats a formatted phone as one term", () => {
  assert.deepEqual(searchTerms("  № 58956  "), ["№58956"]);
  assert.deepEqual(searchTerms("8 (914) 555-01-42"), ["8 (914) 555-01-42"]);
  assert.equal(searchTerms("one ".repeat(100)).length, 8);
  assert.ok(searchTerms("x".repeat(500))[0].length <= 100);
});

test(
  "finds current and closed historical ticket numbers with plain, № and # notation",
  integration,
  async () => {
    await expectIds("58956", ["legacy"]);
    await expectIds("№ 58956", ["legacy"]);
    await expectIds("#58842", ["multiple", "history"]);
    await expectIds("58970", ["multiple"]);
    await expectIds("58700", ["group"]);
  },
);
test(
  "finds company alias/full title and combined company/person/ticket terms",
  integration,
  async () => {
    await expectIds("Вектор", ["legacy", "multiple", "history", "group"]);
    await expectIds("Восточный", ["legacy", "multiple", "history", "group"]);
    await expectIds("Савин Вектор №58956", ["legacy"]);
    await expectIds("Вектор Замена", ["multiple"]);
  },
);
test(
  "finds current HD names in either order, username/email and formatted phone variants",
  integration,
  async () => {
    for (const q of [
      "Алексей Савин",
      "Савин Алексей",
      "@aleksey_savin",
      "a.savin@example.test",
      "external@example.test",
      "+7 (914) 555-01-42",
      "8 914 555 01 42",
    ])
      await expectIds(q, ["legacy", "multiple", "history"]);
    await expectIds("Пётр Лебедев", ["group"]);
    await expectIds("79990000077", []);
    await expectIds("private-staff@internal.test", []);
  },
);
test(
  "searches earlier message text, file names and accessible ticket descriptions",
  integration,
  async () => {
    await expectIds("уникальный старый", ["legacy", "foreign"]);
    await expectIds("уникальный старый", ["legacy"], { scope: ownScope });
    await expectIds("wireguard.conf", ["legacy"]);
    await expectIds("Схема офиса.pdf", ["history"]);
    await expectIds("фотобарабан", ["legacy"]);
    await expectIds("Удалённый доступ", ["multiple", "history"]);
    await expectIds("кракозябра", []);
    await expectIds("удалённый-файл.conf", []);
  },
);
test(
  "keeps queue/company/ticket scope, escapes regex syntax, paginates only after matching",
  integration,
  async () => {
    await expectIds("Скрытая", []);
    await expectIds("Скрытая", ["hidden"], { queue: "hidden" });
    await expectIds("Чужой", [], { scope: ownScope });
    await expectIds("Чужой", ["foreign"], { scope: admin });
    await expectIds("Секретный бюджет", [], { scope: ownScope });
    await expectIds("59999", [], { scope: ownScope });
    await expectIds("Секретный бюджет", ["assignedForeign"], { scope: admin });
    await expectIds("Вектор", [], { company: ids.foreignCompany });
    await expectIds(".*", []);
    const rows = await search("Вектор", { limit: 1 });
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0]._id), String(ids.group));
    assert.ok(Object.keys(rows[0]).every((key) => !key.startsWith("_search")));
  },
);

test(
  "list API uses expanded search before limit while preserving the ordinary no-query path",
  integration,
  async (t) => {
    const modelQuery = (collection, filter) => {
      const cursor = db.collection(collection).find(filter);
      return {
        select(fields) {
          cursor.project(
            Object.fromEntries(fields.split(" ").map((field) => [field, 1])),
          );
          return this;
        },
        sort(spec) {
          cursor.sort(spec);
          return this;
        },
        limit(n) {
          cursor.limit(n);
          return this;
        },
        lean: () => cursor.toArray(),
      };
    };
    const Conversation = require("@/models/conversation");
    t.mock.method(Conversation, "aggregate", (pipeline) =>
      db.collection("conversations").aggregate(pipeline).toArray(),
    );
    t.mock.method(Conversation, "find", (filter) =>
      modelQuery("conversations", filter),
    );
    t.mock.method(Conversation, "countDocuments", (filter) =>
      db.collection("conversations").countDocuments(filter),
    );
    for (const [model, collection] of [
      ["channelIdentity", "channelidentities"],
      ["user", "users"],
      ["company", "companies"],
      ["conversationRead", "conversationreads"],
    ])
      t.mock.method(require(`@/models/${model}`), "find", (filter) =>
        modelQuery(collection, filter),
      );
    t.mock.method(require("@/models/message"), "countDocuments", (filter) =>
      db.collection("messages").countDocuments(filter),
    );
    const controller = require("@/controllers/conversation");
    const call = async (query) => {
      let body;
      await controller.list(
        { auth, query },
        {
          status() {
            return this;
          },
          json(value) {
            body = value;
          },
        },
        (error) => {
          throw error;
        },
      );
      return body;
    };
    const found = await call({ q: "№58956", limit: "1" });
    assert.deepEqual(
      found.items.map((item) => item.id),
      [String(ids.legacy)],
    );
    assert.equal(found.counts.all, 6);
    assert.equal((await call({})).items.length, 6);
    assert.equal((await call({ q: "Вектор", limit: "1" })).items.length, 1);
  },
);

test(
  "search does not scan the whole ticket collection for every visible conversation",
  integration,
  async (t) => {
    t.mock.method(require("@/models/counter"), "findById", async () => ({
      seq: 1,
    }));
    const previous = require.cache[ticketModule];
    delete require.cache[ticketModule];
    const { Ticket } = require("@/models/ticket");
    require.cache[ticketModule] = previous;
    // Use the production schema's applicable indexes, not test-invented ones.
    for (const [keys, options] of Ticket.schema.indexes())
      if (keys.originConversationId)
        await db.collection("tickets").createIndex(keys, options);
    const tickets = Array.from({ length: 5000 }, () => ({
      _id: new ObjectId(),
      num: 80000,
      title: "Unrelated ticket",
      company: { _id: ids.foreignCompany },
    }));
    const conversations = Array.from({ length: 20 }, () => ({
      _id: new ObjectId(),
      kind: "direct",
      network: "telegram",
      lastMessage: { at: new Date() },
      ticketBindings: [],
    }));
    await db.collection("tickets").insertMany(tickets);
    await db.collection("conversations").insertMany(conversations);
    try {
      const report = await db
        .collection("conversations")
        .aggregate(
          conversationSearchPipeline({
            filter: { _id: { $in: conversations.map((row) => row._id) } },
            query: "NoSuchNeedle",
            auth: admin,
            limit: 50,
          }),
        )
        .explain("executionStats");
      const joins = report.stages.filter(
        (stage) => stage.$lookup?.from === "tickets",
      );
      assert.ok(joins.length > 0);
      for (const stage of joins) {
        assert.equal(
          stage.collectionScans,
          0,
          JSON.stringify({
            examined: stage.totalDocsExamined,
            scans: stage.collectionScans,
            indexes: stage.indexesUsed,
          }),
        );
        assert.ok(stage.totalDocsExamined < 1000);
      }
    } finally {
      await db
        .collection("tickets")
        .deleteMany({ _id: { $in: tickets.map((row) => row._id) } });
      await db
        .collection("conversations")
        .deleteMany({ _id: { $in: conversations.map((row) => row._id) } });
    }
  },
);
