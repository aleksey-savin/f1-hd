const { clampInput, stripTags } = require("./textScan");

/**
 * «[текст](адрес)» → «текст»; с маркером «![» — картинка. То же, что
 * `replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")`, но ближайшие «]» и «)» ищутся
 * один раз: регулярка от каждого «[» сканировала хвост до конца, и «[](» ×N
 * без единой «)» разбиралась квадратично.
 *
 * @param {string} text
 * @param {"![" | "["} marker
 */
const unwrapLinks = (text, marker) => {
  let out = "";
  let from = 0;
  let bracket = -1; // ближайшая «]» правее текущего кандидата
  let paren = -1; // ближайшая «)» правее «](»
  let at = text.indexOf(marker);

  while (at !== -1) {
    const label = at + marker.length;
    if (bracket < label) bracket = text.indexOf("]", label);
    // «]» дальше нет — ссылок тоже
    if (bracket === -1) break;

    if (text[bracket + 1] !== "(") {
      at = text.indexOf(marker, at + 1);
      continue;
    }

    if (paren < bracket + 2) paren = text.indexOf(")", bracket + 2);
    // «)» дальше нет — ни эта, ни следующие ссылки не закрываются
    if (paren === -1) break;

    out += text.slice(from, at) + text.slice(label, bracket);
    from = paren + 1;
    at = text.indexOf(marker, from);
  }

  return out + text.slice(from);
};

// Разделитель таблицы или горизонтальная линия: строка только из пробелов, «|»,
// «:» и «-». Проверяется построчно одним классом символов — прежняя
// `^\s*\|?[\s:|-]+\|?\s*$` делила пробелы между тремя квантификаторами и на
// «пробелы + x» работала кубически (3000 пробелов — 14 секунд).
const TABLE_RULE = /^[\s:|-]+$/;

// Снимает базовый Markdown-синтаксис, оставляя чистый текст для глобального
// поиска (plainText). Лёгкий стриппер без внешних зависимостей; каждый шаг —
// за линейное время (см. helpers/textScan).
module.exports.markdownToPlainText = (markdown = "") => {
  if (!markdown || typeof markdown !== "string") {
    return "";
  }

  const withoutCode = clampInput(markdown)
    // блоки кода ```...``` и ~~~...~~~
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    // инлайн-код `...`
    .replace(/`([^`]*)`/g, "$1");

  // изображения ![alt](url) -> alt, затем ссылки [text](url) -> text
  const withoutLinks = unwrapLinks(unwrapLinks(withoutCode, "!["), "[");

  const text = withoutLinks
    // заголовки в начале строки (#, ##, ...)
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // цитаты >
    .replace(/^\s{0,3}>\s?/gm, "")
    // маркеры списков (-, *, +, 1.) в начале строки. Отступ — пробелы и табы
    // своей строки (отбитый неразрывным пробелом маркер списком не считается):
    // прежний `^\s*` захватывал и переводы строк, и серия пустых строк
    // разбиралась квадратично; результат тот же — лишние пробелы схлопнутся.
    // Простой класс, а не `(?:(?=.)\s)*`: V8 12.4 (Node 22) неверно исполняет
    // lookahead внутри квантифицированной группы на однобайтных строках, и у
    // вложенных нумерованных списков маркеры оставались в тексте
    .replace(/^[ \t]*([-*+]|\d+\.)\s+/gm, "")
    // разделители таблиц и горизонтальные линии
    .replace(/.+/g, (line) =>
      TABLE_RULE.test(line) ? " " : line,
    )
    // вертикальные палки таблиц -> пробел
    .replace(/\|/g, " ")
    // эмфазис/зачёркивание ** * __ _ ~~
    .replace(/(\*\*|\*|__|_|~~)/g, "");

  // HTML-теги, если вдруг есть; затем схлопываем пробелы
  return stripTags(text, " ").replace(/\s+/g, " ").trim();
};
