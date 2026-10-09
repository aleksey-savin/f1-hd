// node --test services/mcp/text.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const {
  ticketPlainText,
  buildSnippet,
  iso,
  fallbackTerms,
  hasAllTerms,
  hasHtmlTag,
} = require("./text");
const { MAX_INPUT_LENGTH } = require("../../helpers/textScan");

// Описание заявки бывает трёх видов: HTML из редактора портала, текст письма с
// цитатой прошлой переписки, текст с data:-вставками. Агенту — чистый текст.

test("HTML from the portal editor becomes lines", () => {
  const ticket = {
    source: "Портал",
    description: "<p>Не печатает</p><p>принтер&nbsp;HP в <strong>305</strong></p><p><br></p>",
  };

  assert.equal(ticketPlainText(ticket), "Не печатает\nпринтер HP в 305");
});

test("an e-mail ticket loses the quoted previous correspondence", () => {
  const ticket = {
    source: "Почта",
    description:
      "Добрый день, не работает VPN.\n\nС уважением, Иван\n\nчт, 17 сент. 2026 г. в 10:00, Поддержка F1 <help@f1lab.ru>:\n> Заявка принята",
  };

  assert.equal(ticketPlainText(ticket), "Добрый день, не работает VPN.\n\nС уважением, Иван");
});

test("base64 data is dropped and empty descriptions are empty", () => {
  assert.equal(
    ticketPlainText({ source: "Другое", description: "скрин data:image/png;base64,iVBORw0KGgo= тут" }),
    "скрин [данные] тут",
  );
  assert.equal(ticketPlainText({ source: "Портал" }), "");
});

// Текст заявки идёт в маску и поиск целиком, а описание не ограничено (тело запроса
// до 10 МБ). У HTML-ветки предел есть — htmlToPlainLines режет вход до
// MAX_INPUT_LENGTH, — у простого текста его не было: маска отрабатывала на сотнях
// килобайт. Простой текст режется тем же clampInput, так что весь текст заявки для
// агента не длиннее тех же 256 КБ
test("ticketPlainText: простой текст, письмо и HTML ограничены одним пределом", () => {
  const plain = ticketPlainText({ source: "Портал", description: "x".repeat(MAX_INPUT_LENGTH * 2) });
  assert.equal(plain.length, MAX_INPUT_LENGTH);

  // Письмо: после предела режется ещё цитата, но длину ограничивает тот же предел
  const mail = ticketPlainText({ source: "Почта", description: "y".repeat(MAX_INPUT_LENGTH * 2) });
  assert.equal(mail.length, MAX_INPUT_LENGTH);

  // HTML: предел у htmlToPlainLines, «<p>» входит в первые 256 КБ и снимается вместе с тегом
  const html = ticketPlainText({
    source: "Портал",
    description: `<p>${"z".repeat(MAX_INPUT_LENGTH * 2)}</p>`,
  });
  assert.equal(html.length, MAX_INPUT_LENGTH - "<p>".length);

  // Граница: до предела текст не трогается, на пределе и выше — ровно предел
  const lengths = [MAX_INPUT_LENGTH - 1, MAX_INPUT_LENGTH, MAX_INPUT_LENGTH + 1];
  for (const length of lengths) {
    const text = ticketPlainText({ source: "Портал", description: "w".repeat(length) });
    assert.equal(text.length, Math.min(length, MAX_INPUT_LENGTH), `описание ${length}`);
  }
});

test("ticketPlainText: у длинного текста картинка вырезается до обрезки, хвост после неё остаётся", () => {
  // Скриншот в начале длинного описания не должен съесть предел: clampInput вырезает
  // base64 первым. Метки [данные] у такого текста нет — как и у HTML-ветки; у
  // короткого текста она остаётся (тест выше)
  const image = `data:image/png;base64,${"A".repeat(MAX_INPUT_LENGTH)}`;
  const text = ticketPlainText({ source: "Другое", description: `скрин ${image} и дальше ${"слово ".repeat(100)}КОНЕЦ` });
  assert.ok(!text.includes("base64"), "base64 не вырезан");
  // Картинку вырезает clampInput, а не замена на метку: если заменить на метку
  // раньше обрезки, текст станет коротким и метка останется
  assert.ok(!text.includes("[данные]"), "у длинного текста появилась метка [данные]");
  assert.ok(text.endsWith("КОНЕЦ"), "хвост после картинки потерян");
});

test("snippet and instants keep their previous behaviour", () => {
  assert.equal(iso(null), "—");
  assert.equal(iso(new Date("2026-09-17T10:00:00.000Z")), "2026-09-17T10:00:00.000Z");
  assert.match(buildSnippet(`${"а ".repeat(200)}VPN настроен`, ["vpn"]), /VPN настроен$/);
});

// Снипет живёт одной строкой списка (и у заявок, и у базы знаний): переносы из
// чужого текста схлопываем, иначе строка результата разъезжается.
test("a snippet is a single line", () => {
  const snippet = buildSnippet("первая строка\n\nвторая строка: VPN настроен\nтретья", ["vpn"]);

  assert.ok(!snippet.includes("\n"), snippet);
  assert.match(snippet, /вторая строка: VPN настроен/);
});

test("fallback terms: normalized words, at most 8; every term must occur", () => {
  assert.deepEqual(fallbackTerms("  VPN  192.168.10.5 Ёлка "), ["vpn", "192.168.10.5", "елка"]);
  assert.equal(fallbackTerms("1 2 3 4 5 6 7 8 9 10").length, 8);
  assert.equal(hasAllTerms("Сервер SRV-DC01 в офисе", ["srv-dc01", "офис"]), true);
  assert.equal(hasAllTerms("Сервер SRV-DC01", ["srv-dc01", "склад"]), false);
  assert.equal(hasAllTerms("что угодно", []), false);
});

// ── Определение HTML в описании ────────────────────────────────────────────

// Прежняя регулярка — эталон: на коротких строках она быстрая, и hasHtmlTag обязан
// отвечать так же на любой строке, а не только на обычном тексте
const LEGACY_HTML_TAG = /<\/?[a-z][a-z0-9]*(?:\/?>|\s[^>]*>)/i;

test("hasHtmlTag: тег — это «<», имя и «>», «/>» или пробел с «>» правее", () => {
  const tags = ["<p>", "</p>", "<br>", "<br/>", "<br />", "<a href=\"x\">ссылка</a>", "<A\nHREF=x>", "<h1 >", "<a >", "<a\t>", "<a b>c"];
  for (const sample of tags) assert.equal(hasHtmlTag(sample), true, sample);

  const notTags = [
    "",
    "обычный текст",
    // Адрес из строки отправителя: после имени «e» идёт «@», а не «>» и не пробел
    "Имя <e@x.ru>:",
    "a < b > c",
    "<>",
    "</>",
    "< p>",
    "<//a>",
    "<1>",
    // Нет «>» правее пробела: хвост атрибутов не закрыт
    "<a ",
    "<a b",
    "a > b <a c",
    "<a/b>",
  ];
  for (const sample of notTags) assert.equal(hasHtmlTag(sample), false, sample);
});

test("hasHtmlTag: на любой строке отвечает как прежняя регулярка", () => {
  // Куски, из которых собираются строки: теги, их обломки, пробелы всех видов и
  // «<», «>», «/» вперемешку. Символы заданы кодами, без экранирований в исходнике
  const code = (value) => String.fromCharCode(value);
  const pieces = [
    "<", "<", ">", ">", "/", "a", "b", "A", "Z", "0", "-", ":", "@", ".", '"', "=", " ", " ", "\t", "\n", "\r",
    code(0xa0), code(0x2028), code(0x3000), code(0xfeff), "br", "p", "div", "href", "Имя", "e@x.ru",
    "<b>", "</b>", "<p class=x>", "<br/>", "<br />", "<a href=x>", "<e@x.ru>:", "<>", "<<", "< a>", "<a/>", "</", "<a ", "<//",
    // Буквы, которые при регистронезависимом сравнении могли бы «свернуться» в ASCII
    code(0x130), code(0x131), code(0x17f), code(0x212a),
  ];
  // Детерминированный генератор (mulberry32): тест повторяем, а не случаен
  let state = 20260930;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let withTag = 0;
  for (let i = 0; i < 20000; i += 1) {
    let sample = "";
    const parts = 1 + Math.floor(next() * 24);
    for (let k = 0; k < parts; k += 1) sample += pieces[Math.floor(next() * pieces.length)];
    const expected = LEGACY_HTML_TAG.test(sample);
    if (expected) withTag += 1;
    assert.equal(hasHtmlTag(sample), expected, JSON.stringify(sample));
  }
  // Выборка не вырождена: в ней есть и строки с тегом, и без
  assert.ok(withTag > 2000 && withTag < 18000, `строк с тегом: ${withTag}`);
});

// ── Определение HTML в описании: линейное время ────────────────────────────

const HANG_MS = 3000;

// { timeout } у node:test синхронный код не прерывает (проверено на Node 22 и
// 24), а прежняя регулярка определения HTML на «<a » ×N думала минуты. vm-таймаут
// V8 прерывает и регулярку на середине разбора: регресс роняет тест за HANG_MS,
// а не вешает прогон.
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
    assert.fail(`${label}: не уложился в ${HANG_MS} мс — определение HTML перестало быть линейным`);
  }
  return ms;
};

// Прежняя `<\/?[a-z][a-z0-9]*(?:\/?>|\s[^>]*>)` от каждого «<a » сканировала хвост
// до конца в поисках «>»: «<a » ×40 000 (120 КБ) — 2,8 с, мегабайт — минуты. А
// ticketPlainText зовётся на каждой заявке, которую обходит поиск по заявкам
test("ticketPlainText: мегабайт «<a » разбирается за линейное время", { timeout: 5000 }, () => {
  const MB = 1024 * 1024;
  const inputs = {
    "«<a » ×N, «>» нет": "<a ".repeat(Math.floor(MB / 3)),
    // «>» стоит левее всех «<a »: наивная проверка «в тексте есть >» не годится
    "«>», затем «<a » ×N": `>${"<a ".repeat(Math.floor(MB / 3))}`,
    "«</a » ×N": "</a ".repeat(MB / 4),
  };
  for (const [label, input] of Object.entries(inputs)) {
    let text = "";
    const ms = timed(label, () => {
      text = ticketPlainText({ source: "Портал", description: input });
    });
    // Тега в тексте нет — это не HTML: описание остаётся как есть, но режется до предела
    // простого текста (без хвостового пробела). hasHtmlTag при этом смотрит на весь мегабайт
    assert.ok(text === input.slice(0, MAX_INPUT_LENGTH).trim(), `${label}: описание не совпало с исходным`);
    assert.ok(ms < 200, `${label}: ${ms.toFixed(1)} мс`);
  }
});
