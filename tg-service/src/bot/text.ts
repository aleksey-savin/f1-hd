/**
 * Текстовые преобразования без Telegram и без конфигурации — отдельным
 * модулем, чтобы их можно было проверять тестом: `render.ts` тянет `config`,
 * а тот при запуске требует токен бота.
 */

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
 * @param html разметка описания или комментария
 * @param limit предельная длина результата; 0 — не обрезать
 */
export const plainText = (html: unknown, limit = 0): string => {
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
    // Амперсанд — последним, иначе «&amp;lt;» развернулся бы в тег
    .replace(/&amp;/gi, "&")
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
