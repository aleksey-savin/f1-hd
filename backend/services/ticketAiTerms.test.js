// node --test services/ticketAiTerms.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const Module = require("node:module");

// Модель заявок подменена до загрузки сервиса: models/ticket.js на верхнем
// уровне зовёт initCounter(), и без базы это ~10 с зависания на буферизации и
// строка «Failed to initialize counter» в выводе (тот же приём, что в
// services/mcp/ticketSource.test.js). stripHtml в базу не ходит.
const ticketModel = require.resolve("@/models/ticket");
const ticketStub = new Module(ticketModel);
ticketStub.filename = ticketModel;
ticketStub.loaded = true;
ticketStub.exports = { Ticket: {} };
require.cache[ticketModel] = ticketStub;

const { stripHtml } = require("./ticketAiTerms");

// Прежняя цепочка — эталон: теги снимаются линейным разбором, но порядок шагов
// и результат остаются прежними
const legacyStripHtml = (value) =>
  value
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const SAMPLES = [
  "<p>Первый</p><p>Второй</p>",
  "Строка<br>вторая<br/>третья<br />четвёртая",
  "<ul><li>раз</li><li>два</li></ul><h2>Заголовок</h2>",
  '<a href="x">ссылка</a> &amp; <b>жирный</b> &lt;тег&gt;&nbsp;конец',
  "a < b < c > d и <>",
  "<<>",
  "хвост <незакрытый",
  "строка с хвостом   \nследующая\n\n\n\nещё",
  "без разметки",
  // <br> с пробелами, слэшем и в разном регистре: `<br\s*/?\s*>` менялась
  "а<br  />б< br/>в<br / >г<BR >д<br/ >е<br\n>ж<br / />з",
  // Хвостовые пробелы и табы перед переводом строки, строки из одних пробелов:
  // менялась `[ \t]+\n`
  "строка   \t\nвторая\t \nтретья  \n\n\n\nчетвёртая",
  "\n   \n  текст  \n   ",
  "хвост без перевода строки   ",
  // Письмо из Outlook: неразрывные пробелы, <o:p>, пустые абзацы
  '<p class=MsoNormal>Добрый день!<o:p></o:p></p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal>Не работает 1С.&nbsp;&nbsp;<br>Ошибка при входе </p>',
  "<p>Абзац </p>\n<p>  </p>\n\n\n<p>Ещё</p>",
];

test("ticketAiTerms.stripHtml: цепочка даёт прежний результат", () => {
  for (const sample of SAMPLES) {
    assert.equal(stripHtml(sample), legacyStripHtml(sample), sample);
  }
  // <br> успевает стать переводом строки, а не уходит вместе с тегами
  assert.equal(stripHtml("а<br>б"), "а\nб");
  assert.equal(stripHtml(undefined), "");
  assert.equal(stripHtml(""), "");
});

const HANG_MS = 3000;

// { timeout } у node:test синхронный код не прерывает, а прежняя регулярка `<[^>]+>`
// на мегабайте «<» думала минуты (квадратично). vm-таймаут V8 прерывает и её:
// регресс роняет тест за HANG_MS, а не вешает прогон. Подпись входа — чтобы в
// цикле по формам было видно, какая из них повисла.
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
    assert.fail(`${label}: не уложился в ${HANG_MS} мс — разбор перестал быть линейным`);
  }
  return ms;
};

// Мегабайт «<» без «>»: прежняя `<[^>]+>` от каждого «<» сканировала хвост до конца
test("ticketAiTerms.stripHtml: мегабайт «<» разбирается за линейное время", { timeout: 5000 }, () => {
  const input = "<".repeat(1024 * 1024);
  const ms = timed("мегабайт «<»", () => stripHtml(input));
  assert.ok(ms < 200, `мегабайт «<»: ${ms.toFixed(1)} мс`);
});

// Остальные регулярки цепочки тоже были квадратичными: `[ \t]+\n` (серия пробелов
// без перевода строки сканировалась от каждого пробела: 100 КБ — 7 с) и
// `<\s*br\s*\/?\s*>` (смежные \s*: «<br» и 100 КБ пробелов — столько же)
test("ticketAiTerms.stripHtml: сто килобайт пробелов и «<» с пробелами разбираются за линейное время", { timeout: 5000 }, () => {
  const size = 100 * 1024;
  const inputs = {
    "пробелы без перевода строки": " ".repeat(size),
    "табы без перевода строки": "\t".repeat(size),
    "<br + пробелы": `<br${" ".repeat(size)}`,
    "«< » ×N": "< ".repeat(size / 2),
    "«<» ×N + пробелы": `${"<".repeat(size / 2)}${" ".repeat(size / 2)}`,
  };
  for (const [label, input] of Object.entries(inputs)) {
    const ms = timed(label, () => stripHtml(input));
    assert.ok(ms < 200, `${label}: ${ms.toFixed(1)} мс`);
  }
});
