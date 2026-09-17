// node --test services/mcp/knowledgeTools.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const sift = require("sift").default;

const {
  scopeFilter,
  isServable,
  createKnowledgeTools,
} = require("./knowledgeTools");

/**
 * Инструменты MCP для ИИ-агента: что агенту отдаётся и в каком порядке.
 *
 * Главное свойство — граница: агент видит только одобренные заметки без
 * флага утечки, не в архиве и не на удалении. Заметка, у которой модератор
 * снял все находки («Не секрет» пересчитывает flagged в false), отдаётся —
 * решение владельца 2026-09-17. Граница проверяется дважды: фильтр запроса
 * к Mongo (через sift — те же правила сопоставления) и проверка в памяти,
 * которая держит границу, даже если источник данных отдал лишнее.
 */

const hex = (n) => `64f0${String(n).padStart(20, "0")}`;

// Заметка в форме `.lean()` — со всеми полями модели, как их отдаёт Mongo.
const note = (n, overrides = {}) => ({
  _id: new Types.ObjectId(hex(n)),
  title: `Заметка ${n}`,
  content: "",
  plainText: "",
  type: "info",
  companies: [],
  users: [],
  categories: [],
  approved: true,
  approvedAt: new Date("2026-08-01T09:00:00.000Z"),
  pendingDeletion: false,
  pendingArchive: false,
  secretsScan: { flagged: false, findings: [], ignoredHashes: [] },
  createdAt: new Date("2026-07-01T09:00:00.000Z"),
  updatedAt: new Date("2026-09-01T09:00:00.000Z"),
  ...overrides,
});

// Все про VPN — по тексту подошла бы каждая; решает только граница.
const scopeFixtures = () => {
  const vpn = (n, title, overrides) =>
    note(n, {
      title,
      plainText: "Подключение к VPN офиса через клиент OpenVPN",
      content: "Подключение к **VPN** офиса через клиент OpenVPN",
      ...overrides,
    });
  const legacy = vpn(1, "VPN legacy без сканера");
  delete legacy.secretsScan; // заметка старше сканера — поля нет вовсе
  const legacyUnapproved = vpn(6, "VPN legacy без approved");
  delete legacyUnapproved.approved; // до backfillNoteApproval поля не было
  delete legacyUnapproved.approvedAt;
  return [
    legacy,
    vpn(2, "VPN ни разу не сканировалась"),
    vpn(3, "VPN флаг снят модератором", {
      secretsScan: {
        flagged: false,
        findings: [],
        ignoredHashes: ["3f2a9c1d7b4e8a60"],
        scannedAt: new Date("2026-09-10T03:00:00.000Z"),
      },
    }),
    vpn(4, "VPN с флагом утечки", {
      secretsScan: {
        flagged: true,
        findings: [
          {
            category: "password-near-keyword",
            location: "content",
            maskedSnippet: "R00t••••pass",
            hash: "9b1e0f5c2d7a3e41",
          },
        ],
        ignoredHashes: [],
        scannedAt: new Date("2026-09-10T03:00:00.000Z"),
      },
    }),
    vpn(5, "VPN не одобрена", { approved: false, approvedAt: undefined }),
    legacyUnapproved,
    vpn(7, "VPN в архиве", { archivedAt: new Date("2026-09-05T09:00:00.000Z") }),
    vpn(8, "VPN на удалении", { pendingDeletion: true }),
    vpn(9, "VPN ждёт архивации", { pendingArchive: true }),
  ];
};

const SERVED_TITLES = [
  "VPN legacy без сканера",
  "VPN ни разу не сканировалась",
  "VPN флаг снят модератором",
  "VPN ждёт архивации",
];

// Источник, который НЕ фильтрует: проверка в памяти обязана устоять сама.
const toolsOver = (notes, options = {}) => {
  const logs = [];
  const tools = createKnowledgeTools({
    findCandidates: async () => notes,
    findNoteById: async (id) =>
      notes.find((item) => String(item._id) === id) || null,
    baseUrl: "https://hd.example.ru/",
    log: (level, message, meta) => logs.push({ level, message, meta }),
    ...options,
  });
  return { tools, logs };
};

const textOf = (result) => result.content.map((part) => part.text).join("\n");

const listedIds = (result) =>
  [...textOf(result).matchAll(/knowledge-base\/([a-f0-9]{24})/g)].map(
    (match) => match[1],
  );

test("scope: the Mongo filter and the in-memory guard serve the same notes", () => {
  const notes = scopeFixtures();

  const byFilter = notes.filter(sift(scopeFilter())).map((item) => item.title);
  const byGuard = notes.filter(isServable).map((item) => item.title);

  assert.deepEqual(byFilter, SERVED_TITLES);
  assert.deepEqual(byGuard, SERVED_TITLES);
});

test("search: hidden notes never appear even when the source returns them", async () => {
  const { tools } = toolsOver(scopeFixtures());

  const result = await tools.search({ query: "vpn" });

  assert.ok(!result.isError);
  assert.deepEqual(listedIds(result).sort(), [hex(1), hex(2), hex(3), hex(9)]);
});

test("get: a moderator-cleared note is returned with its content", async () => {
  const { tools } = toolsOver(scopeFixtures());

  const result = await tools.getNote({ id: hex(3) });

  assert.ok(!result.isError);
  assert.match(textOf(result), /VPN флаг снят модератором/);
  assert.match(textOf(result), /Подключение к \*\*VPN\*\* офиса/);
  assert.match(textOf(result), new RegExp(`knowledge-base/${hex(3)}`));
});

test("get: hidden, unknown and malformed ids get one indistinguishable answer", async () => {
  const { tools } = toolsOver(scopeFixtures());

  const answers = await Promise.all(
    [hex(4), hex(5), hex(6), hex(7), hex(8), hex(99), "not-an-id", ""].map(
      (id) => tools.getNote({ id }),
    ),
  );

  for (const answer of answers) {
    assert.equal(answer.isError, true);
    assert.doesNotMatch(textOf(answer), /VPN/);
  }
  assert.equal(new Set(answers.map(textOf)).size, 1);
});

test("search: a title match ranks above a body match, unrelated notes are left out", async () => {
  const { tools } = toolsOver([
    note(11, {
      title: "Заправка картриджей",
      plainText: "Картридж принтера меняем по заявке через офис-менеджера",
    }),
    note(12, { title: "Отпуск", plainText: "Заявление подаётся за две недели" }),
    note(13, { title: "Принтер HP в приёмной", plainText: "Модель LaserJet 1020" }),
  ]);

  const result = await tools.search({ query: "принтер" });

  assert.deepEqual(listedIds(result), [hex(13), hex(11)]);
});

test("search: a note bound to the company named in the query ranks first", async () => {
  // Обе заметки упоминают VPN в тексте одинаково; проверенная позже без
  // привязки стояла бы выше, если бы привязка к компании ничего не весила.
  const { tools } = toolsOver([
    note(21, {
      title: "Удалённый доступ",
      plainText: "Клиент vpn ставит администратор",
      approvedAt: new Date("2026-09-10T09:00:00.000Z"),
    }),
    note(22, {
      title: "Удалённый доступ",
      plainText: "Клиент vpn ставит администратор",
      companies: [{ _id: new Types.ObjectId(hex(900)), alias: "Ромашка" }],
      approvedAt: new Date("2026-09-01T09:00:00.000Z"),
    }),
  ]);

  const result = await tools.search({ query: "vpn ромашка" });

  assert.deepEqual(listedIds(result), [hex(22), hex(21)]);
});

test("search: among equal matches the more recently approved note comes first", async () => {
  // updatedAt ранжировать нельзя: почасовой сканер секретов переписывает его
  // у всех заметок сразу (bulkWrite ставит метки времени), а правка снимает
  // одобрение — у одобренной заметки свежесть текста говорит approvedAt.
  const scanTime = new Date("2026-09-17T09:00:00.623Z");
  const { tools } = toolsOver([
    note(81, {
      title: "VPN инструкция",
      approvedAt: new Date("2026-03-01T09:00:00.000Z"),
      updatedAt: scanTime,
    }),
    note(82, {
      title: "VPN инструкция",
      approvedAt: new Date("2026-09-01T09:00:00.000Z"),
      updatedAt: new Date(scanTime.getTime() - 1),
    }),
  ]);

  const result = await tools.search({ query: "vpn" });

  assert.deepEqual(listedIds(result), [hex(82), hex(81)]);
});

test("search: an IP address is found by substring when the query has no word stems", async () => {
  const { tools } = toolsOver([
    note(31, { title: "Сервер печати", plainText: "Адрес 192.168.10.5, порт 9100" }),
    note(32, { title: "Шлюз", plainText: "Адрес 10.0.0.1" }),
  ]);

  const result = await tools.search({ query: "192.168.10.5" });

  assert.deepEqual(listedIds(result), [hex(31)]);
});

test("search: the snippet shows the matching passage, not the start of the note", async () => {
  const filler = "Вводная часть без сути. ".repeat(40);
  const { tools } = toolsOver([
    note(41, {
      title: "Регламент",
      plainText: `${filler}Для VPN используйте OpenVPN Connect`,
    }),
  ]);

  const text = textOf(await tools.search({ query: "vpn" }));

  assert.match(text, /OpenVPN Connect/);
  assert.ok(!text.includes(filler.slice(0, 200)));
});

test("search: limit caps the listed notes and is clamped to 20", async () => {
  const many = Array.from({ length: 25 }, (_, i) =>
    note(100 + i, { title: `VPN филиал ${i}` }),
  );
  const { tools } = toolsOver(many);

  assert.equal(listedIds(await tools.search({ query: "vpn", limit: 2 })).length, 2);
  assert.equal(listedIds(await tools.search({ query: "vpn", limit: 500 })).length, 20);
  assert.equal(listedIds(await tools.search({ query: "vpn" })).length, 8);
});

test("search: no match is an answer, an empty query is an error", async () => {
  const { tools } = toolsOver([note(51, { title: "Отпуск" })]);

  const nothing = await tools.search({ query: "криптовалюта" });
  const empty = await tools.search({ query: "   " });

  assert.ok(!nothing.isError);
  assert.deepEqual(listedIds(nothing), []);
  assert.equal(empty.isError, true);
});

test("links: the public address is used without a doubled slash, relative without it", async () => {
  const notes = [note(61, { title: "VPN" })];
  const withAddress = toolsOver(notes).tools;
  const withoutAddress = toolsOver(notes, { baseUrl: "" }).tools;

  assert.match(
    textOf(await withAddress.search({ query: "vpn" })),
    new RegExp(`https://hd\\.example\\.ru/knowledge-base/${hex(61)}`),
  );
  const relative = textOf(await withoutAddress.search({ query: "vpn" }));
  assert.match(relative, new RegExp(`(^|\\s)/knowledge-base/${hex(61)}`));
});

test("get: pasted base64 images are replaced and long content is truncated", async () => {
  const image = "![схема сети](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB)";
  const tail = "ХВОСТ-КОТОРЫЙ-НЕ-ВЛЕЗ";
  const { tools } = toolsOver([
    note(71, { title: "Схема", content: `Шаг 1 ${image} шаг 2` }),
    note(72, { title: "Длинная", content: `${"а".repeat(40_000)}${tail}` }),
  ]);

  const withImage = textOf(await tools.getNote({ id: hex(71) }));
  const long = textOf(await tools.getNote({ id: hex(72) }));

  assert.match(withImage, /Шаг 1 \[изображение: схема сети\] шаг 2/);
  assert.ok(!withImage.includes("base64"));
  assert.ok(!long.includes(tail));
  assert.match(long, /truncated/);
});

test("log: each call writes one info line naming the key and the tool", async () => {
  const { tools, logs } = toolsOver(scopeFixtures());
  const caller = { keyId: "66aa00000000000000000001", keyName: "OpenClaw" };

  await tools.search({ query: "vpn" }, caller);
  await tools.getNote({ id: hex(4) }, caller);

  assert.equal(logs.length, 2);
  assert.equal(logs[0].level, "info");
  assert.equal(logs[0].meta.mcpKeyName, "OpenClaw");
  assert.equal(logs[0].meta.tool, "search_knowledge_base");
  assert.equal(logs[0].meta.hits, 4);
  assert.equal(logs[1].meta.tool, "get_knowledge_note");
  assert.equal(logs[1].meta.found, false);
});
