/**
 * Текстовые преобразования без Telegram и без конфигурации — отдельным
 * модулем, чтобы их можно было проверять тестом: `render.ts` тянет `config`,
 * а тот при запуске требует токен бота.
 */

/**
 * Предел входа — 256 К знаков (лимит владельца), как у близнеца в бэкенде
 * (helpers/textScan.js). Карточка заявки в Telegram — 4096 знаков на всё,
 * дальше четверти мегабайта описание читать незачем.
 */
export const MAX_INPUT_LENGTH = 256 * 1024;

// Вставленная картинка — data:-URL прямо в описании: сотни килобайт base64.
// Вырезаем их только из входа длиннее предела и до обрезки: иначе скриншот в
// начале съел бы весь предел, и карточка вышла бы пустой. Короткий вход не
// трогаем — как бэкенд и прежний разбор.
const DATA_URI = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;

/**
 * Вход, приведённый к пределу. Короткий текст возвращается как есть; у длинного
 * сначала вырезаются base64-вставки, и лишь потом остаток обрезается.
 */
const clampInput = (text: string): string => {
  if (text.length <= MAX_INPUT_LENGTH) return text;

  const compact = text.replace(DATA_URI, "");
  if (compact.length <= MAX_INPUT_LENGTH) return compact;

  // Обрезка не должна рвать суррогатную пару: одинокая старшая половина на
  // конце — битая строка
  const cut = compact.slice(0, MAX_INPUT_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
};

/**
 * То же, что `text.replace(/<[^>]+>/g, replacement)`, за один проход: ближайшая
 * «>» ищется один раз, а не заново от каждого «<». Регулярка на «<» ×40 000
 * думала секунды — описание приходит из письма от кого угодно.
 */
const stripTags = (text: string, replacement: string): string => {
  let out = "";
  let from = 0;
  let open = text.indexOf("<");

  while (open !== -1) {
    const close = text.indexOf(">", open + 1);
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
 * То же, что `replace(/<(style|script)[\s\S]*?<\/\1>/gi, replacement)`, но без
 * пересканирования: у тега без закрывающего его нет и у всех следующих.
 */
const stripBlocks = (
  text: string,
  names: string[],
  replacement: string,
): string => {
  const open = new RegExp(`<(${names.join("|")})`, "gi");
  const closers = new Map(
    names.map((name) => [name, new RegExp(`</${name}>`, "gi")] as const),
  );
  const exhausted = new Set<string>();
  let out = "";
  let from = 0;
  let match: RegExpExecArray | null;

  while ((match = open.exec(text)) !== null) {
    const name = (match[1] ?? "").toLowerCase();
    const closer = closers.get(name);
    if (!closer || exhausted.has(name)) continue;

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

/**
 * HTML описания и комментариев → простой текст.
 *
 * Telegram понимает лишь горстку тегов (`b`, `i`, `a`, `code`…), а `<p>` и
 * `<div>` роняют ВСЮ отправку ошибкой разбора, поэтому разметку снимаем, а не
 * пересылаем. Блочные теги превращаются в переводы строк: без этого собранное
 * из ответов описание («ФИО: …», «Пропуск: …») склеилось бы в одну строку.
 *
 * Обрезаем по границе слова: длинное описание бывает на тридцать тысяч знаков
 * (логи бэкапа), а в сообщении всего 4096 на всю карточку.
 *
 * Близнец `htmlToPlainLines` бэкенда (helpers/htmlToPlainText.js +
 * helpers/textScan.js): тот же разбор за линейное время.
 *
 * @param html разметка описания или комментария
 * @param limit предельная длина результата; 0 — не обрезать
 */
export const plainText = (html: unknown, limit = 0): string => {
  const withBreaks = stripBlocks(
    clampInput(String(html ?? "")),
    ["style", "script"],
    " ",
  )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n");

  const text = stripTags(withBreaks, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // Амперсанд — последним, иначе «&amp;lt;» развернулся бы в тег
    .replace(/&amp;/gi, "&")
    // Сначала схлопываем пробелы: следующая замена ищет их по обе стороны
    // перевода строки и на длинной серии пробелов была бы квадратичной
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (!limit || text.length <= limit) return text;

  // Многоточие входит в лимит, а не прибавляется к нему (как у темы заявки
  // на бэкенде)
  const clipped = text.slice(0, limit - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > limit / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
};
