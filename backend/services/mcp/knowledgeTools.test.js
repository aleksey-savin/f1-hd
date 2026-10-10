// node --test services/mcp/knowledgeTools.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const sift = require("sift").default;
const vm = require("node:vm");

const {
  scopeFilter,
  isServable,
  createKnowledgeTools,
  prepareContent,
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
  delete legacyUnapproved.approved; // у старых заметок поля не было
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
  [...textOf(result).matchAll(/id: ([a-f0-9]{24})/g)].map(
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
  assert.match(textOf(result), new RegExp(`id: ${hex(3)}`));
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
    /note link: https:\/\/hd\.example\.ru\/knowledge-base\/<id>\./,
  );
  assert.match(textOf(await withoutAddress.search({ query: "vpn" })), /note link: \/knowledge-base\/<id>\./);
  // Заметка целиком несёт готовую ссылку
  assert.match(
    textOf(await withAddress.getNote({ id: hex(61) })),
    new RegExp(`\nlink: https://hd\\.example\\.ru/knowledge-base/${hex(61)}\n`),
  );
  assert.match(textOf(await withoutAddress.getNote({ id: hex(61) })), new RegExp(`\nlink: /knowledge-base/${hex(61)}\n`));
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

// ── Картинки с data:-адресом ───────────────────────────────────────────────

// Что считается картинкой, записано как есть, вместе с причудами прежней регулярки
// `!\[([^\]]*)\]\(\s*data:[^)]*\)`: адрес идёт до первой «)», подпись — до первой «]»
const IMAGES = [
  ["Шаг 1 ![схема сети](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB) шаг 2", "Шаг 1 [изображение: схема сети] шаг 2"],
  ["![](data:image/png;base64,AAAA)", "[изображение]"],
  ["![  схема  ](data:x)", "[изображение: схема]"],
  // Пробелы, перевод строки и табуляция между «(» и «data:», любой регистр «data:»
  ["![a](  data:text/plain,hi)", "[изображение: a]"],
  ["![a](\n\tdata:text/plain,hi)", "[изображение: a]"],
  ["![a](DATA:text/plain,hi) ![b](Data:text/plain,hi)", "[изображение: a] [изображение: b]"],
  // Обычная картинка и ссылка не трогаются
  ["![x](https://example.ru/a.png) и [ссылка](https://example.ru)", "![x](https://example.ru/a.png) и [ссылка](https://example.ru)"],
  ["![a] (data:x) ![b](dat:x) ![c](http://data:x)", "![a] (data:x) ![b](dat:x) ![c](http://data:x)"],
  // Картинка внутри ссылки: заменяется только она
  [
    "[![превью](data:image/png;base64,QUJD)](https://example.ru/полный-размер)",
    "[[изображение: превью]](https://example.ru/полный-размер)",
  ],
  // Подпись может быть многострочной и содержать «![»; две картинки подряд
  ["![\nмногострочный\nальт](data:text/plain,hi)", "[изображение: многострочный\nальт]"],
  ["![x![y](data:z)", "[изображение: x![y]"],
  ["![a](data:x)![b](data:y)", "[изображение: a][изображение: b]"],
  // Адрес кончается на первой «)», даже если внутри «![» или «(»
  ["![a](data:x ![b](data:y) tail)", "[изображение: a] tail)"],
  ["![a](data:svg+xml;utf8,<svg width=(1)>) хвост", "[изображение: a]>) хвост"],
  // Без закрывающей «)» картинки нет: base64-хвост снимает уже DATA_URI
  ["Незакрытая ![x](data:image/png;base64,AAAA", "Незакрытая ![x]([данные]"],
  ["текст без картинок", "текст без картинок"],
  ["", ""],
];

test("prepareContent: картинки с data:-адресом заменяются как раньше", () => {
  for (const [input, expected] of IMAGES) {
    assert.equal(prepareContent(input), expected, input);
  }
});

// Прежняя реализация — эталон: на коротких текстах регулярка быстрая, и новый
// разбор обязан отвечать так же на любом тексте, а не только на привычных заметках
const LEGACY_DATA_IMAGE = /!\[([^\]]*)\]\(\s*data:[^)]*\)/gi;
const LEGACY_DATA_URI = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;
const legacyPrepareContent = (content) =>
  String(content || "")
    .replace(LEGACY_DATA_IMAGE, (match, alt) =>
      alt.trim() ? `[изображение: ${alt.trim()}]` : "[изображение]",
    )
    .replace(LEGACY_DATA_URI, "[данные]");

test("prepareContent: на любом тексте отвечает как прежняя регулярка", () => {
  // Куски, из которых собираются тексты: скобки картинок, «data:» в разных
  // регистрах, пробелы всех видов. Символы заданы кодами, без экранирований в исходнике
  const code = (value) => String.fromCharCode(value);
  const pieces = [
    "![", "![", "!", "[", "]", "]", "(", "(", ")", ")", "](", "](", "](", ")(", "][",
    "data:", "data:", "DATA:", "Data:", "dat", "data", ":", "data:image/png;base64,", "data:text/plain,",
    "AAAA", "/", "+", "=", ",", ";", " ", " ", "  ", "\n", "\t", "\r\n", code(0xa0), code(0x3000), code(0xfeff), code(0xb),
    "alt", "схема сети", "x", "a b", "Шаг 1",
    "![схема](data:image/png;base64,AAAA)", "![](data:image/png;base64,AAAA)", "![ ](data:x)", "![x](https://example.ru/a.png)",
    "[ссылка](https://example.ru)", "![](  data:text/plain,hi)", "[![alt](data:image/png;base64,QUJD)](https://example.ru)",
    "Привет", "заметка",
  ];
  // Детерминированный генератор (mulberry32): тест повторяем, а не случаен
  let state = 20261001;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let replaced = 0;
  for (let i = 0; i < 20000; i += 1) {
    let sample = "";
    const parts = 1 + Math.floor(next() * 24);
    for (let k = 0; k < parts; k += 1) sample += pieces[Math.floor(next() * pieces.length)];
    const expected = legacyPrepareContent(sample);
    if (expected !== sample) replaced += 1;
    assert.equal(prepareContent(sample), expected, JSON.stringify(sample));
  }
  // Выборка не вырождена: в ней есть и тексты с картинкой, и без
  assert.ok(replaced > 2000 && replaced < 19000, `текстов с картинкой: ${replaced}`);
});

// ── Картинки с data:-адресом: линейное время ───────────────────────────────

const HANG_MS = 3000;

// { timeout } у node:test синхронный код не прерывает (проверено на Node 22 и
// 24), а прежняя регулярка картинки на таких заметках думала секунды и минуты.
// vm-таймаут V8 прерывает и её: регресс роняет тест за HANG_MS, а не вешает прогон.
// Время меряем процессорное (process.cpuUsage), а не стенными часами: под нагрузкой
// процесс вытесняют, и стенные часы давали ложные падения. vm-таймаут остаётся по
// стенным часам — это страховка от зависания, а не измерение.
const timed = (label, run) => {
  let ms = 0;
  const measure = () => {
    const cpuBefore = process.cpuUsage();
    run();
    const cpu = process.cpuUsage(cpuBefore);
    ms = (cpu.user + cpu.system) / 1000;
  };
  try {
    vm.runInNewContext("measure()", { measure }, { timeout: HANG_MS });
  } catch (error) {
    if (error?.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    assert.fail(`${label}: не уложился в ${HANG_MS} мс — разбор картинок перестал быть линейным`);
  }
  return ms;
};

// Прежняя `!\[([^\]]*)\]\(\s*data:[^)]*\)` от каждого «![» заново искала «]» и «)»
// до конца текста: «![](data:» ×N без «)» — 160 КБ за 1,7 с, мегабайт — минуты. А
// заметку отдают целиком (до 50 МБ), и картинки снимаются до обрезки на 40 000 знаков
test("prepareContent: мегабайт «![](data:», «![» и незакрытых картинок разбирается за линейное время", { timeout: 5000 }, () => {
  const MB = 1024 * 1024;
  const shapes = {
    "«![](data:» ×N, «)» нет": "![](data:".repeat(Math.floor(MB / 9)),
    "«![» ×N, «]» нет": "![".repeat(MB / 2),
    // Одна «]» на все «![»: каждый старт читает один и тот же хвост
    "«![» ×N, одна «](» и пробелы": `${"![".repeat(MB / 4)}](${" ".repeat(MB / 2)}x`,
    "«![](  » ×N: пробелы после «(», «data:» нет": "![](  ".repeat(Math.floor(MB / 6)),
  };
  for (const [label, content] of Object.entries(shapes)) {
    let text = "";
    const ms = timed(label, () => {
      text = prepareContent(content);
    });
    assert.ok(text.length > 0, label);
    assert.ok(ms < 500, `${label}: ${ms.toFixed(1)} мс`);
  }
});
