// node --test helpers/textScan.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const {
  MAX_INPUT_LENGTH,
  clampInput,
  stripTags,
  stripBlocks,
} = require("./textScan");

// Прежние регулярки — эталон поведения. На коротких входах они быстрые, и
// новый разбор обязан совпадать с ними символ в символ.
const legacyTags = (text, replacement) => text.replace(/<[^>]+>/g, replacement);
const legacyStyle = (text) => text.replace(/<style[\s\S]*?<\/style>/gi, " ");
const legacyBlocks = (text) =>
  text.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ");

const TRICKY = [
  "",
  "без тегов",
  "<p>Первый</p><p>Второй</p>",
  '<a href="x">ссылка</a> и <b>жирный</b>',
  "a <> b",
  "<<>",
  "a < b < c > d",
  "<a <b>текст</b>",
  "хвост <незакрытый",
  "><>",
  "<br/><br />",
  "<p>1</p>\n<p>2</p>",
];

test("stripTags совпадает с /<[^>]+>/g, включая кривые случаи", () => {
  for (const sample of TRICKY) {
    assert.equal(stripTags(sample, " "), legacyTags(sample, " "), sample);
    assert.equal(stripTags(sample, ""), legacyTags(sample, ""), sample);
  }
});

const BLOCKS = [
  "<style>p{color:red}</style>текст",
  "<STYLE type='x'>a</Style>текст<script>alert(1)</SCRIPT>ещё",
  "<style>без закрытия <script>x</script> после",
  "<script>a</script><style>b</style><script>c",
  "<style>a</script>b</style>",
  "<stylesheet>не блок</stylesheet> и <style>блок</style>",
  "<style>1</style><style>2</style>",
  "текст без блоков",
];

test("stripBlocks совпадает с прежними регулярками style/script", () => {
  for (const sample of BLOCKS) {
    assert.equal(stripBlocks(sample, ["style"], " "), legacyStyle(sample), sample);
    assert.equal(
      stripBlocks(sample, ["style", "script"], " "),
      legacyBlocks(sample),
      sample,
    );
  }
});

// ── clampInput ─────────────────────────────────────────────────────────────

// Эмодзи — две кодовые единицы UTF-16 (суррогатная пара). Собираем из кодовой
// точки, а не пишем в исходнике: так пара не зависит от редактора и кодировки
const EMOJI = String.fromCodePoint(0x1f600);

test("clampInput: короткий вход возвращается как есть — data:-URL в нём остаётся", () => {
  const withImage = "<p>скрин data:image/png;base64,iVBORw0KGgo= тут</p>";
  assert.equal(clampInput(withImage), withImage);
  assert.equal(clampInput("короткий"), "короткий");

  // Ровно на пределе вход ещё «короткий»: вставку не трогаем. Сравнение через
  // ok, а не equal: при падении equal печатает диф из 256 КБ
  const head = "data:image/png;base64,AAAA ";
  const atLimit = head + "x".repeat(MAX_INPUT_LENGTH - head.length);
  assert.equal(atLimit.length, MAX_INPUT_LENGTH);
  assert.ok(clampInput(atLimit) === atLimit, "вход ровно на пределе изменился");
});

test("clampInput: у входа длиннее предела base64-вставка вырезается до обрезки", () => {
  const image = `data:image/png;base64,${"A".repeat(300 * 1024)}`;
  assert.equal(clampInput(`<img src="${image}">текст`), '<img src="">текст');

  // Хвост после вставки не теряется: обрежь вход раньше, он ушёл бы за предел
  const head = "x".repeat(MAX_INPUT_LENGTH - 10);
  assert.ok(
    clampInput(`${head}${image} КОНЕЦ`) === `${head} КОНЕЦ`,
    "хвост после вставки потерян",
  );
});

test("clampInput: граница предела — до него без изменений, дальше ровно MAX_INPUT_LENGTH", () => {
  const cases = [
    [MAX_INPUT_LENGTH - 1, MAX_INPUT_LENGTH - 1],
    [MAX_INPUT_LENGTH, MAX_INPUT_LENGTH],
    [MAX_INPUT_LENGTH + 1, MAX_INPUT_LENGTH],
    [MAX_INPUT_LENGTH + 10, MAX_INPUT_LENGTH],
  ];
  for (const [length, expected] of cases) {
    assert.equal(clampInput("x".repeat(length)).length, expected, `вход ${length}`);
  }
});

test("clampInput: обрезка не рвёт суррогатную пару", () => {
  // Эмодзи стоит на границе: старшая половина — последняя в пределе, младшая
  // уходит за него. Одинокая старшая половина — битая строка (в Mongo она
  // превратилась бы в U+FFFD), поэтому её отбрасываем
  const straddling = clampInput(`${"a".repeat(MAX_INPUT_LENGTH - 1)}${EMOJI}хвост`);
  assert.equal(straddling.length, MAX_INPUT_LENGTH - 1);
  assert.equal(straddling.at(-1), "a");
  assert.ok(straddling.isWellFormed(), "на конце осталась половина пары");

  // Пара целиком внутри предела остаётся
  const inside = clampInput(`${"a".repeat(MAX_INPUT_LENGTH - 2)}${EMOJI}хвост`);
  assert.equal(inside.length, MAX_INPUT_LENGTH);
  assert.ok(inside.endsWith(EMOJI), "целая пара внутри предела отрезана");
  assert.ok(inside.isWellFormed());

  // Поток эмодзи: граница приходится на старшую половину очередной пары
  const flood = clampInput(`a${EMOJI.repeat(MAX_INPUT_LENGTH)}`);
  assert.equal(flood.length, MAX_INPUT_LENGTH - 1);
  assert.ok(flood.endsWith(EMOJI), "на конце не целая пара");
  assert.ok(flood.isWellFormed());
});

// ── Линейное время ─────────────────────────────────────────────────────────

// Спека требует < 100 мс на мегабайт. Порог в тесте — 500 мс, чтобы загруженная
// машина не давала ложных падений: прежний код на тех же входах думал минуты и
// часы, так что граница всё равно отделяет линейное от квадратичного.
const LINEAR_BOUND_MS = 500;
const HANG_MS = 3000;
const MB = 1024 * 1024;

// { timeout } у node:test синхронный код не прерывает (проверено на Node 22 и
// 24: тест на 1,5 с с timeout 200 мс проходит), а прежние регулярки на мегабайте
// думали минуты. vm-таймаут V8 прерывает и регулярку на середине разбора:
// регресс к квадратичному коду роняет тест за HANG_MS, а не вешает прогон.
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

test("textScan: мегабайт враждебного ввода разбирается за линейное время", { timeout: 5000 }, () => {
  const inputs = {
    "<×N": "<".repeat(MB),
    "<style×N": "<style".repeat(MB / 8),
    "<script×N": "<script".repeat(MB / 8),
    "<a ×N": "<a ".repeat(MB / 4),
    // clampInput сканирует вход целиком — рой мелких data:-URL тоже должен быть линейным
    "data:-URL×N": "data:a/b;base64,AA ".repeat(Math.floor(MB / 19)),
  };
  for (const [label, input] of Object.entries(inputs)) {
    const ms = timed(label, () => {
      clampInput(input);
      stripTags(input, " ");
      stripBlocks(input, ["style", "script"], " ");
      stripBlocks(input, ["style"], " ");
    });
    assert.ok(ms < LINEAR_BOUND_MS, `${label}: ${ms.toFixed(1)} мс`);
  }
});
