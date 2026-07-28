/**
 * HTML-письмо «отчёт ждёт вашей подписи».
 *
 * Половина согласующих в приложение не заходит — для них это письмо и есть
 * интерфейс. Прежний вариант был голым абзацем текста со ссылкой на localhost и
 * читался как спам, поэтому здесь решается ровно одна задача: чтобы человек
 * поверил письму и нажал одну кнопку.
 *
 * Что делает письмо достоверным (и почему оно выглядит именно так):
 *  - обращение по имени и названная роль: видно, что письмо не рассылка;
 *  - блок фактов вместо описаний — период, работы, часы, деньги парами
 *    «подпись → значение». Проверяемая конкретика убеждает лучше слов;
 *  - ровно одно действие. Вторая кнопка превратила бы письмо в лендинг;
 *  - сказано, почему письмо пришло и что будет, если не отвечать;
 *  - НИ ОДНОЙ внешней картинки: заблокированные изображения — первое, из-за
 *    чего письмо выглядит мусорным, а логотип из сети блокируется всегда.
 *
 * Технические рамки почты, а не выбор вкуса: таблицы вместо flex/grid, стили
 * инлайном (Outlook выбрасывает внешние), системный шрифт (вебшрифты не
 * грузятся). Тёмная тема — `@media`, её понимают не все клиенты, поэтому
 * светлый вариант базовый и самодостаточный.
 */

const C = {
  canvas: "#f4f5f6",
  paper: "#ffffff",
  ink: "#1d2227",
  muted: "#677078",
  faint: "#99a1a8",
  line: "#e2e5e8",
  hair: "#eef0f2",
  primary: "#00bc8c",
  accent: "#007a5e",
  warn: "#b26a00",
};

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/** Строка выписки: подпись слева, значение справа, волосяная линия сверху. */
const factRow = (label, value, { strong = false, tone } = {}) => `
  <tr>
    <td style="padding:9px 0;border-top:1px solid ${C.hair};font:400 14px/1.4 ${FONT};color:${C.muted}">${esc(label)}</td>
    <td align="right" style="padding:9px 0;border-top:1px solid ${C.hair};font:${strong ? "700 16px" : "600 14px"}/1.4 ${FONT};color:${tone || C.ink};white-space:nowrap;font-variant-numeric:tabular-nums">${esc(value)}</td>
  </tr>`;

/**
 * @param {object} input
 * @param {string} input.greeting     — «Андрей» или пусто
 * @param {string} input.role         — за что отвечает адресат
 * @param {string} input.company
 * @param {string} input.contractor  — кто прислал отчёт
 * @param {string} input.servicePlan
 * @param {string} input.period
 * @param {Array<[string,string,object?]>} input.facts — строки выписки
 * @param {string|null} input.link
 * @param {string|null} input.deadline
 * @param {boolean} input.isReminder
 */
const renderApprovalEmail = ({
  greeting,
  role,
  company,
  contractor,
  servicePlan,
  period,
  facts = [],
  link,
  deadline,
  isReminder = false,
}) => {
  const title = isReminder
    ? "Напоминание: отчёт ждёт вашей подписи"
    : "Отчёт на согласование";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .canvas { background: #16181c !important; }
    .paper  { background: #1d2024 !important; }
    .ink    { color: #eceef0 !important; }
    .muted  { color: #9aa1a9 !important; }
    .faint  { color: #6f767d !important; }
    .hair   { border-color: #2b2f35 !important; }
    .rule   { background: #2b2f35 !important; }
  }
  @media (max-width: 620px) {
    .pad { padding-left: 22px !important; padding-right: 22px !important; }
    .h1  { font-size: 20px !important; }
  }
</style>
</head>
<body class="canvas" style="margin:0;padding:0;background:${C.canvas};-webkit-font-smoothing:antialiased">
<!-- Прехедер: строка-подсказка в списке входящих. Говорит, о чём письмо, а не
     кому оно адресовано — роль в списке писем ничего не сообщает -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(
    `${contractor || ""} · ${servicePlan} · ${period}`.replace(/^ · /, ""),
  )}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="canvas" style="background:${C.canvas}">
<tr><td align="center" style="padding:28px 12px 40px">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">

    <!-- кант: единственный фирменный элемент, картинка тут была бы заблокирована -->
    <tr><td style="height:3px;background:${C.primary};font-size:0;line-height:0;border-radius:3px 3px 0 0">&nbsp;</td></tr>

    <tr><td class="paper" style="background:${C.paper};border-radius:0 0 12px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

        <tr><td class="pad" style="padding:26px 32px 0">
          <div class="faint" style="font:700 11px/1.4 ${FONT};letter-spacing:.09em;text-transform:uppercase;color:${C.faint}">
            ${esc(company)} &nbsp;·&nbsp; ${esc(period)}
          </div>
          <h1 class="ink h1" style="margin:9px 0 0;font:600 22px/1.25 ${FONT};color:${C.ink};letter-spacing:-.01em">
            ${esc(servicePlan)}
          </h1>
          <p class="muted" style="margin:10px 0 0;font:400 15px/1.55 ${FONT};color:${C.muted}">
            ${greeting ? `${esc(greeting)}, о` : "О"}тчёт по этой услуге ждёт вашей подписи${
              role ? ` как ${esc(role)}` : ""
            }.
          </p>
        </td></tr>

        <tr><td class="pad" style="padding:18px 32px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${facts
              .map(([label, value, options]) => factRow(label, value, options))
              .join("")}
          </table>
        </td></tr>

        ${
          link
            ? `<tr><td class="pad" style="padding:24px 32px 0">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="border-radius:8px;background:${C.primary}">
              <a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px">Открыть отчёт</a>
            </td></tr>
          </table>
        </td></tr>`
            : ""
        }

        ${
          deadline
            ? `<tr><td class="pad" style="padding:18px 32px 0">
          <p class="muted" style="margin:0;font:400 14px/1.55 ${FONT};color:${C.muted}">
            Ответить нужно до <b style="color:${C.warn}">${esc(deadline)}</b> — без ответа отчёт согласуется автоматически.
          </p>
        </td></tr>`
            : ""
        }

        <tr><td class="pad" style="padding:22px 32px 0">
          <div class="rule" style="height:1px;background:${C.line};font-size:0;line-height:0">&nbsp;</div>
        </td></tr>

        <tr><td class="pad" style="padding:14px 32px 26px">
          <p class="faint" style="margin:0;font:400 12px/1.6 ${FONT};color:${C.faint}">
            ${contractor ? `Отчёт прислал ${esc(contractor)}. ` : ""}Письмо пришло, потому что вы назначены согласующим по этой услуге.
            Ссылка персональная и действует один раз — не пересылайте её.
            Решение можно принять и в личном кабинете.
          </p>
        </td></tr>

      </table>
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
};

module.exports = { renderApprovalEmail };
