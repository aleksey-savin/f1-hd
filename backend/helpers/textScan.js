/**
 * Разбор текста за линейное время — общие части htmlToPlainText,
 * htmlToPlainLines и markdownToPlainText.
 *
 * Прежние регулярки пересканировали хвост строки от каждого кандидата:
 * `<[^>]+>` на «<» ×40 000 думала секунды, `<style[\s\S]*?<\/style>` без
 * закрывающего тега — квадратично. Текст приходит из писем и с портала, то есть
 * от кого угодно, и разбирается в кронах уведомлений. Здесь те же правила, но
 * каждый символ просматривается константное число раз, а результат совпадает с
 * прежними регулярками символ в символ.
 *
 * Близнец в tg-service — `src/bot/text.ts`: своей копии бэкенда у сервиса нет.
 */

/**
 * Предел входа — 256 К знаков (лимит владельца). Темам, превью, уведомлениям и
 * контексту ИИ дальше не нужно, но не только им: markdownToPlainText собирает
 * сохранённый plainText заметок базы знаний, а его целиком читают поиск по базе
 * (controllers/knowledgeNote.js), сканер секретов (services/secretsScanner.js) и
 * поиск MCP. Теперь они видят plainText только из первых 256 К знаков заметки;
 * обрезка идёт по исходному тексту, до снятия блоков кода и разметки.
 */
const MAX_INPUT_LENGTH = 256 * 1024;

// Вставленная картинка — data:-URL прямо в тексте (Toast UI так кладёт
// скриншоты и в HTML описания, и в Markdown заметки): сотни килобайт base64.
// Вырезаем их только из входа длиннее предела и ДО обрезки: иначе один
// скриншот в начале съел бы весь предел, и тема заявки вышла бы пустой.
// Короткий вход не трогаем, как и прежние помощники: например, MCP заменяет
// такую ссылку в тексте меткой [данные] (services/mcp/text.js). Классы без «:» —
// прогон от одного «data:» не заходит в следующий, поэтому линейно.
const DATA_URI = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;

/**
 * Вход, приведённый к пределу. Короткий текст возвращается как есть; у длинного
 * сначала вырезаются base64-вставки, и лишь потом остаток обрезается.
 */
const clampInput = (text) => {
  if (text.length <= MAX_INPUT_LENGTH) return text;

  const compact = text.replace(DATA_URI, "");
  if (compact.length <= MAX_INPUT_LENGTH) return compact;

  // Обрезка не должна рвать суррогатную пару: одинокая старшая половина на
  // конце — битая строка (в Mongo она стала бы U+FFFD)
  const cut = compact.slice(0, MAX_INPUT_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
};

/**
 * То же, что `text.replace(/<[^>]+>/g, replacement)`, за один проход: ближайшая
 * «>» ищется один раз, а не заново от каждого «<».
 */
const stripTags = (text, replacement) => {
  let out = "";
  let from = 0;
  let open = text.indexOf("<");

  while (open !== -1) {
    const close = text.indexOf(">", open + 1);
    // Закрывающих дальше нет — значит, и тегов больше нет
    if (close === -1) break;

    // «<>» тегом не считался: [^>]+ требует хотя бы один символ
    if (close === open + 1) {
      open = text.indexOf("<", close);
      continue;
    }

    out += text.slice(from, open) + replacement;
    from = close + 1;
    open = text.indexOf("<", from);
  }

  return out + text.slice(from);
};

/**
 * То же, что `replace(/<(style|script)[\s\S]*?<\/\1>/gi, replacement)` (для
 * одного имени — `/<style[\s\S]*?<\/style>/gi`), но без пересканирования: если
 * у открывающего тега нет закрывающего, дальше его нет и у всех следующих
 * тегов с тем же именем — повторно не ищем.
 *
 * @param {string} text
 * @param {string[]} names имена блоков в нижнем регистре
 * @param {string} replacement
 */
const stripBlocks = (text, names, replacement) => {
  const open = new RegExp(`<(${names.join("|")})`, "gi");
  const closers = new Map(
    names.map((name) => [name, new RegExp(`</${name}>`, "gi")]),
  );
  const exhausted = new Set();
  let out = "";
  let from = 0;
  let match;

  while ((match = open.exec(text)) !== null) {
    const name = match[1].toLowerCase();
    if (exhausted.has(name)) continue;

    const closer = closers.get(name);
    closer.lastIndex = open.lastIndex;
    const end = closer.exec(text);
    if (!end) {
      exhausted.add(name);
      if (exhausted.size === names.length) break;
      continue;
    }

    out += text.slice(from, match.index) + replacement;
    from = closer.lastIndex;
    open.lastIndex = from;
  }

  return out + text.slice(from);
};

module.exports = { MAX_INPUT_LENGTH, clampInput, stripTags, stripBlocks };
