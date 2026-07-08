// Вырезание цитируемой переписки из почтовых ответов. Почтовые клиенты при
// ответе цитируют всё предыдущее письмо, и без чистки комментарий к заявке
// состоит в основном из этого хвоста. Отрезанное не выбрасывается — уходит в
// comment.quotedText и раскрывается в UI по клику.

// Маркер, который отправщик уведомлений добавляет первой строкой в каждое
// исходящее email-уведомление (telegram-bot/controllers/emailController.js).
// В ответе клиента он оказывается процитированным — всё от него и ниже
// отрезается независимо от почтового клиента и языка. Не менять текст без
// синхронного изменения в отправщике.
const REPLY_MARKER = "##- Пожалуйста, пишите ответ над этой строкой -##";

// Строки-заголовки, которыми клиенты предваряют цитату в plain-text части.
const QUOTE_HEADERS = [
  // Thunderbird (ru): "07.07.2026 15:07, Техподдержка F1Lab пишет:"
  /^\d{1,2}\.\d{1,2}\.\d{2,4}\s+\d{1,2}:\d{2},[^\n]*пишет:\s*$/m,
  // Apple Mail (ru): "8 июл. 2026 г., в 11:39, Имя <e@x.ru> написал(а):"
  /^\d{1,2}\s+[а-яё]{3,8}\.?\s+\d{4}\s?г\.,?\s+в\s+\d{1,2}:\d{2},[^\n]*написал[аи]?\s*(\(а\))?:\s*$/im,
  // Gmail (ru): "вт, 8 июл. 2026 г. в 11:39, Имя <e@x.ru>:"
  /^(пн|вт|ср|чт|пт|сб|вс),\s+\d{1,2}\s+[а-яё]{3,8}\.?\s+\d{4}\s?г\.\s+в\s+\d{1,2}:\d{2},[^\n]*:\s*$/im,
  // Яндекс.Почта / Mail.ru и похожие: строка с временем, оканчивающаяся
  // адресом в угловых скобках и двоеточием:
  // '02.05.2023, 11:39, "Имя" <e@x.ru>:' /
  // 'Понедельник, 8 июля 2026, 11:39 +10:00 от Имя <e@x.ru>:'
  /^[^\n]{0,80}\d{1,2}:\d{2}[^\n]{0,160}<[^\s@<>]+@[^\s@<>]+>:\s*$/m,
  // Gmail/Apple Mail (en): "On Tue, Jul 8, 2026 at 11:39 AM X <x@y> wrote:"
  // (длинный заголовок клиент может перенести на вторую строку)
  /^On\s[^\n]{0,200}(\n[^\n]{0,200})?wrote:\s*$/m,
  // Outlook и пересылки: "-----Original Message-----" и локализованные варианты
  /^-{2,}\s*(Original Message|Исходное сообщение|Пересылаемое сообщение|Forwarded message)\s*-{2,}\s*$/im,
  // Outlook без разделителя: блок заголовков "От: ..." + "Отправлено/Дата: ..."
  /^(От|From):\s[^\n]+\n(Отправлено|Sent|Дата|Date):\s/im,
];

// Начало хвостового блока ">"-строк: последняя непустая нецитатная строка
// обрывает блок. Пустые строки внутри блока допустимы. Возвращает индекс
// символа начала блока или -1.
const tailQuoteBlockStart = (text) => {
  const lines = text.split("\n");
  let firstQuotedLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(">")) {
      firstQuotedLine = i;
      continue;
    }
    if (lines[i].trim() === "") continue;
    break;
  }
  if (firstQuotedLine === -1) return -1;
  return firstQuotedLine === 0
    ? 0
    : lines.slice(0, firstQuotedLine).join("\n").length + 1;
};

// Возвращает { content, quotedText }: content — текст ответа без цитируемого
// хвоста, quotedText — отрезанный хвост ("" если ничего не отрезано). Если
// после чистки не остаётся ничего (весь текст — цитата, например ответ написан
// внутри неё), исходный текст возвращается нетронутым — лучше «багаж», чем
// потерянный ответ.
const stripQuotedReply = (text) => {
  const original = (text || "").replace(/\r\n/g, "\n");
  if (!original.trim()) return { content: original, quotedText: "" };

  const candidates = [];

  const markerIdx = original.indexOf(REPLY_MARKER);
  if (markerIdx !== -1) {
    // отрезаем с начала строки, содержащей маркер (перед ним стоит "> ")
    candidates.push(original.lastIndexOf("\n", markerIdx) + 1);
  }

  for (const re of QUOTE_HEADERS) {
    const match = re.exec(original);
    if (match) candidates.push(match.index);
  }

  const tailStart = tailQuoteBlockStart(original);
  if (tailStart !== -1) candidates.push(tailStart);

  if (!candidates.length) return { content: original.trim(), quotedText: "" };

  const cutAt = Math.min(...candidates);
  const content = original.slice(0, cutAt).trim();
  const quotedText = original.slice(cutAt).trim();

  if (!content) return { content: original.trim(), quotedText: "" };
  return { content, quotedText };
};

module.exports = { stripQuotedReply, REPLY_MARKER };
