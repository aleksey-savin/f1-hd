// node --test helpers/htmlToPlainText.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const { htmlToPlainText, htmlToPlainLines } = require("./htmlToPlainText");

test("htmlToPlainText: одна строка для поиска — переводы строк не нужны", () => {
  assert.equal(
    htmlToPlainText("<p>Первый</p><p>Второй</p>"),
    "Первый Второй",
  );
});

test("htmlToPlainLines: абзацы и <br> становятся переводами строк", () => {
  assert.equal(
    htmlToPlainLines("<p>Первый</p><p>Второй</p>"),
    "Первый\nВторой",
  );
  assert.equal(htmlToPlainLines("А<br>Б<br/>В"), "А\nБ\nВ");
});

test("htmlToPlainLines: собранное из ответов описание — строка на вопрос", () => {
  assert.equal(
    htmlToPlainLines(
      "<p><strong>ФИО:</strong> Петрова Анна</p><p><strong>Пропуск:</strong> Да</p>",
    ),
    "ФИО: Петрова Анна\nПропуск: Да",
  );
});

test("htmlToPlainLines: пустой документ редактора — пустая строка", () => {
  assert.equal(htmlToPlainLines("<p><br></p>"), "");
  assert.equal(htmlToPlainLines(""), "");
  assert.equal(htmlToPlainLines(null), "");
});

test("htmlToPlainLines: entity раскрываются, амперсанд не ломает теги", () => {
  assert.equal(
    htmlToPlainLines("<p>Сервер &laquo;1С&raquo; &amp; касса &lt;тест&gt;</p>"),
    "Сервер «1С» & касса <тест>",
  );
  assert.equal(htmlToPlainLines("<p>А&nbsp;Б</p>"), "А Б");
});

test("htmlToPlainLines: пустые абзацы не оставляют дыр", () => {
  assert.equal(htmlToPlainLines("<p>А</p><p></p><p>Б</p>"), "А\nБ");
});

test("htmlToPlainLines: длинный текст режется по границе слова", () => {
  const clipped = htmlToPlainLines(`<p>${"слово ".repeat(300)}</p>`, 50);
  assert.ok(clipped.length <= 50, `длина ${clipped.length}`);
  assert.ok(clipped.endsWith("…"));
  assert.ok(!/\sсло…$/.test(clipped), "обрыв посреди слова");
});

test("htmlToPlainLines: короткий текст не трогается", () => {
  assert.equal(htmlToPlainLines("<p>Не работает почта</p>", 50), "Не работает почта");
});

// ── Линейный разбор (helpers/textScan) ─────────────────────────────────────

const { MAX_INPUT_LENGTH } = require("./textScan");

// Прежние реализации — эталон: на обычных описаниях новый разбор обязан
// совпадать с ними символ в символ.
const legacyPlainText = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const legacyPlainLines = (html) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

const SAMPLES = [
  "<p>Первый</p><p>Второй</p>",
  "<p><strong>ФИО:</strong> Петрова Анна</p><p><strong>Пропуск:</strong> Да</p>",
  "<p>Сервер &laquo;1С&raquo; &amp; касса &lt;тест&gt; &quot;да&quot; &#39;нет&#39;</p>",
  "<style>p{color:red}</style><p>После стиля</p><script>alert(1)</script>хвост",
  "<STYLE>a</STYLE>Текст<br/>строка<br >ещё",
  "<div><span>(</span>Единая база</div><h2>Заголовок</h2><blockquote>цитата</blockquote>",
  "a < b < c > d и <>",
  "<p>Незакрытый <b тег",
  "Без разметки,\n  с переводом\t\tстроки",
  "<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>",
  '<p><a href="https://example.ru/?a=1&amp;b=2">ссылка</a></p>',
  // data:-URL в тексте, а не в теге: короткий вход не трогается, и MCP по-прежнему
  // видит такую ссылку и ставит на её место метку [данные]
  "<p>скрин data:image/png;base64,iVBORw0KGgo= тут</p>",
  "<p>Пример: <code>data:application/json;base64,eyJhIjoxfQ==</code></p>",
];

test("htmlToPlainText/htmlToPlainLines совпадают с прежним разбором", () => {
  for (const sample of SAMPLES) {
    assert.equal(htmlToPlainText(sample), legacyPlainText(sample), sample);
    assert.equal(htmlToPlainLines(sample), legacyPlainLines(sample), sample);
  }
});

test("htmlToPlainText/htmlToPlainLines: скриншот в начале описания не съедает предел входа", () => {
  const html = `<p><img src="data:image/png;base64,${"A".repeat(MAX_INPUT_LENGTH)}"></p><p>Не печатает принтер</p>`;
  assert.equal(htmlToPlainText(html), "Не печатает принтер");
  assert.equal(htmlToPlainLines(html), "Не печатает принтер");
});

test("htmlToPlainText/htmlToPlainLines: вход длиннее предела обрезается ровно до него", () => {
  // Один символ без пробелов: ни trim, ни схлопывание пробелов длины не меняют
  const huge = "x".repeat(MAX_INPUT_LENGTH * 2);
  assert.equal(htmlToPlainText(huge).length, MAX_INPUT_LENGTH);
  assert.equal(htmlToPlainLines(huge).length, MAX_INPUT_LENGTH);
});

test("htmlToPlainText/htmlToPlainLines: обрезка не оставляет половину суррогатной пары", () => {
  // Эмодзи — через кодовую точку: пара не зависит от редактора и кодировки.
  // Граница приходится на старшую половину очередной пары
  const emoji = String.fromCodePoint(0x1f600);
  const flood = `a${emoji.repeat(MAX_INPUT_LENGTH)}`;
  for (const text of [htmlToPlainText(flood), htmlToPlainLines(flood)]) {
    assert.equal(text.length, MAX_INPUT_LENGTH - 1);
    assert.ok(text.isWellFormed(), "на конце осталась половина пары");
  }
});

// ── Линейное время ─────────────────────────────────────────────────────────

// Спека требует < 100 мс на мегабайт; порог теста — 500 мс, чтобы загруженная
// машина не давала ложных падений. Прежний разбор думал на этих входах от
// секунд до десятков минут, так что граница всё равно отделяет линейное от
// квадратичного.
const LINEAR_BOUND_MS = 500;
const HANG_MS = 3000;

// { timeout } у node:test синхронный код не прерывает (проверено на Node 22 и
// 24: тест на 1,5 с с timeout 200 мс проходит), а прежние регулярки на таких
// входах думали минуты. vm-таймаут V8 прерывает и регулярку на середине
// разбора: регресс к квадратичному коду роняет тест за HANG_MS, а не вешает
// прогон.
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

test("htmlToPlainText/htmlToPlainLines: враждебный ввод предельной длины разбирается за линейное время", { timeout: 5000 }, () => {
  // Публичные функции режут вход до MAX_INPUT_LENGTH, так что длиннее предела
  // входы не делаем: триггер (x за пробелами) остался бы за обрезкой, и тест
  // проверял бы не то, что заявляет. Раньше «пробелы+x» собирался на мегабайт
  // (x на индексе 1 048 576, за обрезкой до 262 144); теперь x стоит на индексе
  // MAX-1.
  const inputs = {
    "<×N": "<".repeat(MAX_INPUT_LENGTH),
    "<style×N": "<style".repeat(Math.floor(MAX_INPUT_LENGTH / 6)),
    "<script×N": "<script".repeat(Math.floor(MAX_INPUT_LENGTH / 7)),
    "пробелы+x": `${" ".repeat(MAX_INPUT_LENGTH - 1)}x`,
    "<br+пробелы": `<br${" ".repeat(MAX_INPUT_LENGTH - 3)}`,
  };
  for (const [label, input] of Object.entries(inputs)) {
    assert.ok(input.length <= MAX_INPUT_LENGTH, `${label}: вход длиннее предела, триггер обрежется`);
    const ms = timed(label, () => {
      htmlToPlainText(input);
      htmlToPlainLines(input, 1000);
    });
    assert.ok(ms < LINEAR_BOUND_MS, `${label}: ${ms.toFixed(1)} мс`);
  }
});
