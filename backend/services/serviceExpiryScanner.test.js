// node --test services/serviceExpiryScanner.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const { parseServiceTables, extractTables } = require("./serviceExpiryScanner");

// Парсер таблиц услуг из markdown-заметок: домены, хостинг, сертификаты. Для
// сканера сроков важны два свойства: строки-разделители отбрасываются, а
// остальное читается как было, — и на любой строке таблицы он укладывается во
// время (заметку пишет человек, а правит хоть бы и вставка из чужого документа).

test("parseServiceTables: таблицы услуг, в том числе с отступом и своими заголовками", () => {
  const note = [
    "# Домены клиента",
    "",
    "| Домен | Регистратор | Продление |",
    "|---|:---:|---:|",
    "| bsb.ru | REG.RU | 15.03.2027 |",
    "| syndicate-portcafe.online | Timeweb | 2027-01-09 |",
    "",
    "Текст между таблицами",
    "",
    "  | Услуга | Дата |",
    "  | --- | --- |",
    "  | example.com | 01/02/2028 |",
  ].join("\n");

  assert.deepEqual(parseServiceTables(note), [
    { service: "bsb.ru", registrar: "REG.RU", expiresAt: new Date("2027-03-15T00:00:00.000Z") },
    { service: "syndicate-portcafe.online", registrar: "Timeweb", expiresAt: new Date("2027-01-09T00:00:00.000Z") },
    { service: "example.com", registrar: "", expiresAt: new Date("2028-02-01T00:00:00.000Z") },
  ]);
});

// Строка из одних пробелов, «|», «:» и «-» — разделитель и в данные не попадает
const SEPARATORS = [
  "|---|---|",
  "| --- | --- |",
  "|:---|---:|",
  "| :---: | :---: |",
  "|-|-|",
  "||",
  "| | |",
  "|  |  |",
  "  |---|---|  ",
  "|---|---|\t",
  "\t|---|---|",
];

// Всё, где есть хоть один другой знак, — строка данных
const ROWS = ["| a | b |", "| --- x |", "| a-b | c |", "| 1 | 2 |", "|---|--a|", "| : . : |"];

const rowsAround = (line) => {
  const [table] = extractTables(`| Домен | Продление |\n${line}\n| a.ru | 01.01.2030 |`);
  return table.rows.length;
};

test("extractTables: строка-разделитель отбрасывается, строка данных остаётся", () => {
  for (const line of SEPARATORS) assert.equal(rowsAround(line), 1, JSON.stringify(line));
  for (const line of ROWS) assert.equal(rowsAround(line), 2, JSON.stringify(line));
});

// Прежнее правило — эталон: на коротких строках оно быстрое, и новое обязано
// решать так же на любой строке таблицы, а не только на привычных разделителях
const LEGACY_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;

test("extractTables: разделитель решается как прежней регуляркой — на любой строке таблицы", () => {
  // Куски строк таблицы; символы заданы кодами, без экранирований в исходнике.
  // Перевода строки нет: он делит строки раньше, чем дело дойдёт до правила
  const code = (value) => String.fromCharCode(value);
  const pieces = [
    " ", " ", "  ", "\t", code(0xa0), code(0x3000), code(0xfeff), code(0xb), "-", "--", "---", ":", ":-", "|", "|", " | ",
    "a", "x", "1", ".", "_", "*", "=", "я",
  ];
  let state = 20261001;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let separators = 0;
  for (let i = 0; i < 20000; i += 1) {
    // Строка таблицы начинается и кончается «|» (иначе она в таблицу не попадёт)
    let body = "";
    const parts = Math.floor(next() * 12);
    for (let k = 0; k < parts; k += 1) body += pieces[Math.floor(next() * pieces.length)];
    const indent = next() < 0.3 ? " ".repeat(1 + Math.floor(next() * 3)) : "";
    const line = `${indent}|${body}|`;

    const expected = LEGACY_SEPARATOR.test(line);
    if (expected) separators += 1;
    assert.equal(rowsAround(line), expected ? 1 : 2, JSON.stringify(line));
  }
  // Выборка не вырождена: в ней есть и разделители, и строки данных
  assert.ok(separators > 1000 && separators < 19000, `разделителей: ${separators}`);
});

// ── Линейное время ─────────────────────────────────────────────────────────

const HANG_MS = 3000;

// { timeout } у node:test синхронный код не прерывает (проверено на Node 22 и
// 24), а прежняя регулярка разделителя на таких строках думала секунды и минуты.
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
    assert.fail(`${label}: не уложился в ${HANG_MS} мс — разбор строки таблицы перестал быть линейным`);
  }
  return ms;
};

// Прежняя `^\s*\|?[\s:|-]+\|?\s*$` делила серию пробелов между тремя квантификаторами:
// на «пробелы + |x|» 3000 пробелов думали 6,5 с (кубически), 6000 — больше 20 с, а
// «| + пробелы + x|» — квадратично. Строку с отступом из пробелов пишет и вставка из
// чужого документа; разбор идёт на каждом сохранении заметки и в ночном проходе
test("serviceExpiryScanner: строки таблицы со сто килобайтами пробелов разбираются за линейное время", { timeout: 5000 }, () => {
  const size = 100 * 1024;
  const shapes = {
    "пробелы + «|x|»": `${" ".repeat(size)}|x|`,
    "табы + «|x|»": `${"\t".repeat(size)}|x|`,
    "«|» + пробелы + «x|»": `|${" ".repeat(size)}x|`,
    "пробелы + «|» + пробелы + «x|»": `${" ".repeat(size / 2)}|${" ".repeat(size / 2)}x|`,
    "«| »×N + «x|»": `${"| ".repeat(size / 2)}x|`,
  };
  for (const [label, line] of Object.entries(shapes)) {
    const note = `| Домен | Продление |\n${line}\n| a.ru | 01.01.2030 |`;
    const ms = timed(label, () => parseServiceTables(note));
    assert.ok(ms < 500, `${label}: ${ms.toFixed(1)} мс`);
  }
});
