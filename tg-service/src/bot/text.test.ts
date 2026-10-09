// node --test src/bot/text.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { MAX_INPUT_LENGTH, plainText } from "./text.ts";

test("абзацы и переводы строк становятся переводами строк", () => {
  assert.equal(
    plainText("<p>Первый</p><p>Второй</p>"),
    "Первый\nВторой",
  );
  assert.equal(plainText("Строка<br>Вторая<br/>Третья"), "Строка\nВторая\nТретья");
});

test("собранное из ответов описание читается строкой на вопрос", () => {
  assert.equal(
    plainText(
      "<p><strong>ФИО:</strong> Петрова Анна</p><p><strong>Пропуск:</strong> Да</p>",
    ),
    "ФИО: Петрова Анна\nПропуск: Да",
  );
});

test("теги снимаются, entity раскрываются", () => {
  assert.equal(
    plainText('<div class="x">Сервер &laquo;1С&raquo; &amp; касса &lt;тест&gt;</div>'),
    "Сервер «1С» & касса <тест>",
  );
  assert.equal(plainText("<p>А&nbsp;Б</p>"), "А Б");
});

test("пустой документ редактора — пустая строка", () => {
  assert.equal(plainText("<p><br></p>"), "");
  assert.equal(plainText(""), "");
  assert.equal(plainText(undefined), "");
  assert.equal(plainText("   \n  "), "");
});

test("списки не склеиваются в одно слово", () => {
  assert.equal(
    plainText("<ul><li>Первый</li><li>Второй</li></ul>"),
    "Первый\nВторой",
  );
});

test("пустые строки подряд сжимаются до одной", () => {
  assert.equal(plainText("<p>А</p><p></p><p></p><p>Б</p>"), "А\nБ");
});

test("длинный текст режется по границе слова с многоточием", () => {
  const long = plainText(`<p>${"слово ".repeat(200)}</p>`, 60);
  assert.ok(long.length <= 60, `длина ${long.length}`);
  assert.ok(long.endsWith("…"));
  assert.ok(!long.endsWith("сло…"), "обрыв посреди слова");
});

test("короткий текст не трогается", () => {
  assert.equal(plainText("<p>Не работает почта</p>", 60), "Не работает почта");
});

// ── Линейный разбор ────────────────────────────────────────────────────────

// Прежняя реализация — эталон: на обычных описаниях новый разбор обязан
// совпадать с ней символ в символ.
const legacyPlainText = (html: unknown, limit = 0): string => {
  const text = String(html ?? "")
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
  if (!limit || text.length <= limit) return text;
  const clipped = text.slice(0, limit - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > limit / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
};

const SAMPLES = [
  "<p>Первый</p><p>Второй</p>",
  "<p><strong>ФИО:</strong> Петрова Анна</p><p><strong>Пропуск:</strong> Да</p>",
  '<div class="x">Сервер &laquo;1С&raquo; &amp; касса &lt;тест&gt;</div>',
  "<ul><li>Первый</li><li>Второй</li></ul>",
  "<style>p{color:red}</style><p>После стиля</p><script>alert(1)</script>",
  "<STYLE>a</STYLE>Текст<br/>строка<br >ещё",
  "a < b < c > d",
  "<p>Незакрытый <b тег",
  "Без разметки,\n  с переводом\t\tстроки",
  "<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>",
  `<p>${"слово ".repeat(40)}</p>`,
  // data:-URL в тексте, а не в теге: короткий вход не трогается
  "<p>скрин data:image/png;base64,iVBORw0KGgo= тут</p>",
  "<p>Пример: <code>data:application/json;base64,eyJhIjoxfQ==</code></p>",
];

test("plainText: совпадает с прежней реализацией на обычных описаниях", () => {
  for (const sample of SAMPLES) {
    assert.equal(plainText(sample), legacyPlainText(sample), sample);
    assert.equal(plainText(sample, 40), legacyPlainText(sample, 40), sample);
  }
});

test("plainText: скриншот в начале описания не съедает предел входа", () => {
  const html = `<p><img src="data:image/png;base64,${"A".repeat(MAX_INPUT_LENGTH)}"></p><p>Не печатает принтер</p>`;
  assert.equal(plainText(html), "Не печатает принтер");
});

test("plainText: data:-URL в коротком тексте остаётся, у входа длиннее предела вырезается до обрезки", () => {
  assert.equal(
    plainText("<p>скрин data:image/png;base64,iVBORw0KGgo= тут</p>"),
    "скрин data:image/png;base64,iVBORw0KGgo= тут",
  );

  // Вход длиннее предела: вставка уходит первой, хвост за ней не теряется
  const image = `data:image/png;base64,${"A".repeat(300 * 1024)}`;
  const head = "x".repeat(MAX_INPUT_LENGTH - 10);
  // Сравнение через ok, а не equal: при падении equal печатает диф из 256 КБ
  assert.ok(
    plainText(`${head}${image} КОНЕЦ`) === `${head} КОНЕЦ`,
    "хвост после вставки потерян",
  );
});

test("plainText: вход длиннее предела обрезается ровно до него", () => {
  // Один символ без пробелов: ни trim, ни схлопывание пробелов длины не меняют.
  // Ровно MAX_INPUT_LENGTH, а не «не больше»: на границе и ±1 от неё
  const cases: [number, number][] = [
    [MAX_INPUT_LENGTH - 1, MAX_INPUT_LENGTH - 1],
    [MAX_INPUT_LENGTH, MAX_INPUT_LENGTH],
    [MAX_INPUT_LENGTH + 1, MAX_INPUT_LENGTH],
    [MAX_INPUT_LENGTH * 2, MAX_INPUT_LENGTH],
  ];
  for (const [length, expected] of cases) {
    assert.equal(plainText("x".repeat(length)).length, expected, `вход ${length}`);
  }
});

// Старшая половина суррогатной пары — код 0xD800..0xDBFF. isWellFormed — это
// ES2024, а в lib проекта es2023
const endsWithLoneHighSurrogate = (text: string): boolean => {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff;
};

test("plainText: обрезка не оставляет половину суррогатной пары", () => {
  // Эмодзи — через кодовую точку: пара не зависит от редактора и кодировки.
  // Граница приходится на старшую половину очередной пары
  const emoji = String.fromCodePoint(0x1f600);
  const flood = plainText(`a${emoji.repeat(MAX_INPUT_LENGTH)}`);
  assert.equal(flood.length, MAX_INPUT_LENGTH - 1);
  assert.ok(flood.endsWith(emoji), "на конце не целая пара");

  // Эмодзи стоит на границе: старшая половина — последняя в пределе
  const straddling = plainText(`${"a".repeat(MAX_INPUT_LENGTH - 1)}${emoji}хвост`);
  assert.equal(straddling.length, MAX_INPUT_LENGTH - 1);
  assert.equal(endsWithLoneHighSurrogate(straddling), false);

  // Пара целиком внутри предела остаётся
  const inside = plainText(`${"a".repeat(MAX_INPUT_LENGTH - 2)}${emoji}хвост`);
  assert.equal(inside.length, MAX_INPUT_LENGTH);
  assert.ok(inside.endsWith(emoji), "целая пара внутри предела отрезана");
});

// ── Линейное время ─────────────────────────────────────────────────────────

// Спека требует < 100 мс на мегабайт; порог теста — 500 мс, чтобы загруженная
// машина не давала ложных падений. Прежний разбор думал на этих входах секунды
// и минуты, так что граница всё равно отделяет линейное от квадратичного.
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
const timed = (label: string, run: () => void): number => {
  let ms = 0;
  const measure = (): void => {
    const cpuBefore = process.cpuUsage();
    run();
    const cpu = process.cpuUsage(cpuBefore);
    ms = (cpu.user + cpu.system) / 1000;
  };
  try {
    vm.runInNewContext("measure()", { measure }, { timeout: HANG_MS });
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    assert.fail(`${label}: не уложился в ${HANG_MS} мс — разбор перестал быть линейным`);
  }
  return ms;
};

test("plainText: враждебный ввод предельной длины разбирается за линейное время", { timeout: 5000 }, () => {
  // plainText режет вход до MAX_INPUT_LENGTH, поэтому триггер (x за пробелами)
  // должен стоять в первых MAX_INPUT_LENGTH знаках — иначе обрезка снимет его, и
  // тест проверит не то, что заявляет. Раньше «пробелы+x» собирался на мегабайт
  // (x на индексе 1 048 576, за обрезкой до 262 144); теперь x стоит на индексе
  // MAX-1.
  const inputs: Record<string, string> = {
    "<×N": "<".repeat(MAX_INPUT_LENGTH),
    "<style×N": "<style".repeat(Math.floor(MAX_INPUT_LENGTH / 6)),
    "<script×N": "<script".repeat(Math.floor(MAX_INPUT_LENGTH / 7)),
    "пробелы+x": `${" ".repeat(MAX_INPUT_LENGTH - 1)}x`,
    "<br+пробелы": `<br${" ".repeat(MAX_INPUT_LENGTH - 3)}`,
  };
  for (const [label, input] of Object.entries(inputs)) {
    assert.ok(input.length <= MAX_INPUT_LENGTH, `${label}: вход длиннее предела, триггер обрежется`);
    const ms = timed(label, () => {
      plainText(input, 600);
    });
    assert.ok(ms < LINEAR_BOUND_MS, `${label}: ${ms.toFixed(1)} мс`);
  }
});
