// node --test helpers/markdownToPlainText.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const { markdownToPlainText } = require("./markdownToPlainText");
const { MAX_INPUT_LENGTH } = require("./textScan");

// Прежняя реализация — эталон: на обычных заметках новый разбор обязан
// совпадать с ней символ в символ.
const legacyMarkdownToPlainText = (markdown) =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/(\*\*|\*|__|_|~~)/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const SAMPLES = [
  "# Заголовок\n\nТекст **жирный** и _курсив_, ~~зачёркнутый~~.",
  "## Сервер\n\n| Имя | Адрес |\n|---|:---:|\n| srv-dc01 | контроллер |\n\n---\n\nПосле таблицы",
  "- первый\n- второй\n  * вложенный\n1. нумерованный\n\n\n+ плюс",
  "> цитата\n>> вложенная\nобычная строка",
  "Код `npm ci` и блок:\n```bash\nrm -rf /\n```\nи ~~~\nещё\n~~~ конец",
  "[ссылка](https://example.ru/a_(b)) и ![скриншот](data:image/png;base64,iVBORw0KGgo=)",
  // data:-URL в инлайн-коде остаётся в тексте: короткий вход base64-вставок не режет
  "Пример: `data:text/plain;base64,SGVsbG8=` в тексте",
  "[![значок](img.png)](https://example.ru) и [пустая]()",
  "Стрелки <- назад и -> вперёд, a < b < c > d, <b>тег</b>",
  "Строка с отступом\n    - не список ли?\n\t- с табом",
  "Пусто\n\n\n\n\nПосле пустых строк",
  "Кириллица и символ 𝔸 вне BMP в конце",
  // Чистый ASCII: однобайтный путь движка (см. тест про вложенные списки ниже)
  "1. one\n   1. nested\n\t2. tab\n  12. two digits",
  "- a\n  - b",
];

test("markdownToPlainText: совпадает с прежним разбором на обычных заметках", () => {
  for (const sample of SAMPLES) {
    assert.equal(markdownToPlainText(sample), legacyMarkdownToPlainText(sample), sample);
  }
});

// V8 12.4 (Node 22) неверно исполнял `^(?:(?=.)\s)*([-*+]|\d+\.)\s+` на
// однобайтных строках (ASCII и Latin-1): у вложенного нумерованного списка
// маркеры «1.» оставались в тексте. Строки с кириллицей идут двухбайтным путём
// и ошибку скрывали, поэтому образцы здесь — чистый ASCII. Регулярку движок
// прогревает не с первого вызова — гоняем несколько раз.
test("markdownToPlainText: вложенные списки на ASCII теряют маркеры при любом числе вызовов", () => {
  for (let run = 0; run < 5; run += 1) {
    assert.equal(
      markdownToPlainText("1. one\n   1. nested\n\t2. tab"),
      "one nested tab",
    );
    assert.equal(markdownToPlainText("- a\n  - b"), "a b");
    assert.equal(
      markdownToPlainText("1. one\n   1. nested\n\t2. tab\n  12. two digits"),
      "one nested tab two digits",
    );
  }
});

test("пустое и не-строка — пустая строка", () => {
  assert.equal(markdownToPlainText(""), "");
  assert.equal(markdownToPlainText(null), "");
  assert.equal(markdownToPlainText(42), "");
});

test("markdownToPlainText: скриншот в начале заметки не съедает предел входа", () => {
  const note = `![схема](data:image/png;base64,${"A".repeat(MAX_INPUT_LENGTH)})\n\nПароль от роутера у администратора`;
  assert.equal(markdownToPlainText(note), "схема Пароль от роутера у администратора");
});

test("markdownToPlainText: вход длиннее предела обрезается ровно до него", () => {
  // Один символ без пробелов: ни trim, ни схлопывание пробелов длины не меняют
  assert.equal(
    markdownToPlainText("x".repeat(MAX_INPUT_LENGTH * 2)).length,
    MAX_INPUT_LENGTH,
  );
});

test("markdownToPlainText: обрезка не оставляет половину суррогатной пары", () => {
  // Эмодзи — через кодовую точку: пара не зависит от редактора и кодировки.
  // Граница приходится на старшую половину очередной пары
  const emoji = String.fromCodePoint(0x1f600);
  const text = markdownToPlainText(`a${emoji.repeat(MAX_INPUT_LENGTH)}`);
  assert.equal(text.length, MAX_INPUT_LENGTH - 1);
  assert.ok(text.isWellFormed(), "на конце осталась половина пары");
});

// ── Линейное время ─────────────────────────────────────────────────────────

// Спека требует < 100 мс на мегабайт; порог теста — 500 мс, чтобы загруженная
// машина не давала ложных падений. Прежний разбор думал на «пробелы + x» в
// 3000 знаков 14 секунд (кубически), на остальных входах — квадратично.
const LINEAR_BOUND_MS = 500;
const HANG_MS = 3000;

// { timeout } у node:test синхронный код не прерывает (проверено на Node 22 и
// 24: тест на 1,5 с с timeout 200 мс проходит), а прежние регулярки на таких
// входах думали минуты и часы. vm-таймаут V8 прерывает и регулярку на середине
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

test("markdownToPlainText: враждебный ввод предельной длины разбирается за линейное время", { timeout: 5000 }, () => {
  // markdownToPlainText режет вход до MAX_INPUT_LENGTH, поэтому триггеры должны
  // стоять в первых MAX_INPUT_LENGTH знаках — иначе обрезка снимет их, и тест
  // проверит не то, что заявляет. Раньше «пробелы+x» (x на индексе 1 048 576),
  // «![×N» («]x» на 1 048 576), «перевод+пробел» и «~~~×N» (x на 1 048 576 и
  // 1 048 575) собирались на мегабайт и теряли триггер при обрезке до 262 144.
  // Теперь x стоит на индексе MAX-1 («пробелы+x», «~~~×N»), MAX-2
  // («перевод+пробел+x»), а «]x» — на MAX-2 и MAX-1 («![×N»).
  const inputs = {
    "пробелы+x": `${" ".repeat(MAX_INPUT_LENGTH - 1)}x`,
    "переводы строк": "\n".repeat(MAX_INPUT_LENGTH),
    "перевод+пробел+x": `${"\n ".repeat(MAX_INPUT_LENGTH / 2 - 1)}x`,
    "![](×N": "![](".repeat(MAX_INPUT_LENGTH / 4),
    "[](×N": "[](".repeat(Math.floor(MAX_INPUT_LENGTH / 3)),
    "![×N": `${"![".repeat(MAX_INPUT_LENGTH / 2 - 1)}]x`,
    "<×N": "<".repeat(MAX_INPUT_LENGTH),
    "~~~×N": `${"~~~".repeat(Math.floor((MAX_INPUT_LENGTH - 1) / 3))}x`,
  };
  for (const [label, input] of Object.entries(inputs)) {
    assert.ok(input.length <= MAX_INPUT_LENGTH, `${label}: вход длиннее предела, триггер обрежется`);
    const ms = timed(label, () => markdownToPlainText(input));
    assert.ok(ms < LINEAR_BOUND_MS, `${label}: ${ms.toFixed(1)} мс`);
  }
});
