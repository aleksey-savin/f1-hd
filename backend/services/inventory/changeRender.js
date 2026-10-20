// Тексты и кнопки предложения ИИ-агента по инвентарю: сообщение на утверждение, подтверждение, итог.
// Чистые функции: без моделей и ввода-вывода. Текст — обычными строками; в Telegram и в письмо он уходит
// HTML-экранированным (services/notifications/fanOut), длина меряется по экранированному тексту, как у Mikrotik.
const { STATUS } = require("./changeSteps");
const { escapeHtml } = require("../telegramMessage");

const MAX_LENGTH = 3500;
const DEFAULT_TZ = "Europe/Moscow";
// Потолок одной строки операции (заголовка или подстроки); всё сообщение — MAX_LENGTH
const LINE_MAX = 500;
const ERROR_MAX = 300;
// Тот же текст — у алерта tg-service (NOT_FITS в tg-service/src/bot/inventoryChange.ts)
const BIG_NOTE = "Пакет большой — утвердить можно в портале";
const SUB_LEAD = "   – ";

// Чужой текст (агент, система) — в одну строку и с потолком: перевод строки подделывает чужие строки сообщения
const oneLine = (text, max) => {
  // eslint-disable-next-line no-control-regex -- вычищаем разделители \u001c-\u001f и NEL: JS не считает их пробелами
  const t = String(text ?? "").replace(/[\s\u0085\u001c-\u001f]+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const wireLength = (text) => escapeHtml(text).length;
const idOf = (v) => (v && typeof v === "object" && "_id" in v ? String(v._id) : v == null ? "" : String(v));
const pathOf = (change) => `/inventory/changes/${idOf(change)}`;
const opsOf = (change) => change.operations || [];
const titleOf = (change) => oneLine(change.title, 200);
// Название пишет агент: в тексте оно в кавычках, чтобы не сойти за служебную строку
const quotedTitle = (change) => `«${titleOf(change)}»`;
const agentLine = (change) => {
  const name = oneLine(change.requestedVia?.keyName, 60);
  return name ? `Агент: ${name}` : "";
};

// Последний предел: длина меряется по экранированному тексту (& < > растут до 5 знаков)
const clamp = (text) => {
  if (wireLength(text) <= MAX_LENGTH) return text;
  let cut = Math.min(text.length, MAX_LENGTH - 1);
  while (cut > 0 && wireLength(`${text.slice(0, cut)}…`) > MAX_LENGTH) cut = Math.floor(cut * 0.9);
  return `${text.slice(0, cut).trimEnd()}…`;
};

// --- время

const stamp = (date, timezone) => {
  const p = {};
  for (const part of new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone || DEFAULT_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(date))) p[part.type] = part.value;
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
};

// --- ссылки и кнопки

// Telegram отвергает кнопку-ссылку не на https и на localhost, и роняет всё сообщение: тогда ссылки нет совсем.
const buttonUrl = (baseUrl, change) => {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base) || /^https:\/\/(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(base)) return null;
  return `${base}${pathOf(change)}`;
};
const mailUrl = (baseUrl, change) => {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return base ? `${base}${pathOf(change)}` : null;
};

function keyboardFor(change, fits, { baseUrl } = {}) {
  const rows = [];
  if (fits) {
    const id = idOf(change);
    rows.push([
      { text: "Утвердить", callback_data: `ic:a:${id}` },
      { text: "Отклонить", callback_data: `ic:r:${id}` },
    ]);
  }
  const url = buttonUrl(baseUrl, change);
  if (url) rows.push([{ text: "Открыть в портале", url }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

// Клавиатура итога: решений нет, только ссылка
const linkKeyboard = (change, baseUrl) => keyboardFor(change, false, { baseUrl });

// --- тексты

const HEADER = "ИИ-агент предлагает изменения в учёте техники";

// Операция — заголовок и подстроки «   – …» из её собственных переводов строки (записи каталога,
// детали своей сборки). Каждая строка чистится и ограничивается отдельно, а подстроки начинаются с
// отступа: чужой перевод строки не подделает номер следующей операции. whole — ни одна строка не обрезана.
const operationBlock = (text, lead) => {
  const raw = String(text ?? "").split("\n").map((line) => oneLine(line, Infinity)).filter(Boolean);
  const whole = raw.every((line) => line.length <= LINE_MAX);
  const [head = "", ...subs] = raw.map((line) => oneLine(line, LINE_MAX));
  return { lines: [`${lead}${head}`, ...subs.map((sub) => `${SUB_LEAD}${sub}`)], whole };
};

// Операция показывается целиком или не показывается: под кнопками решения резать текст нельзя
const operationLine = (op, index) => operationBlock(op.text, `${index + 1}. `);

function messageFor(change, ctx = {}) {
  const ops = opsOf(change);
  const total = ops.length;
  const lines = ops.map((op, i) => operationLine(op, i));
  const top = [HEADER, quotedTitle(change), ...(agentLine(change) ? [agentLine(change)] : [])];
  const reason = oneLine(change.reason, 1000);
  if (reason) top.push(`Причина: ${reason}`);
  const tail = change.expiresAt ? ["", `Ждёт утверждения до ${stamp(change.expiresAt, ctx.timezone)}`] : [];
  const compose = (count) => {
    const more = total - count;
    const out = [...top, "", ...lines.slice(0, count).flatMap((l) => l.lines)];
    if (more > 0) out.push(`…и ещё ${more}`, "", BIG_NOTE);
    return [...out, ...(more > 0 ? [] : tail)].join("\n");
  };
  const firstCut = lines.findIndex((l) => !l.whole);
  const showable = firstCut === -1 ? total : firstCut;
  // ctx.big — решать в Telegram нельзя по другой причине (не влезло подтверждение): вид большого пакета
  if (!ctx.big && showable === total && wireLength(compose(total)) <= MAX_LENGTH) return { text: compose(total), fits: true };
  let count = Math.min(showable, Math.max(total - 1, 0));
  while (count > 0 && wireLength(compose(count)) > MAX_LENGTH) count--;
  const text = compose(count);
  return { text: clamp(text), fits: false };
}

// Подтверждение повторяет операции целиком: утверждать вслепую нельзя. Не влезло в потолок Telegram
// или операция не показывается целиком — null (решать можно в портале).
function confirmFor(change) {
  const id = idOf(change);
  const ops = opsOf(change);
  const lines = ops.map((op, i) => operationLine(op, i));
  if (lines.some((l) => !l.whole)) return null;
  const text = [
    HEADER,
    quotedTitle(change),
    "",
    `Применить операции (${ops.length}) в учёте техники?`,
    "Откатить уже применённое автоматически нельзя: если операция не пройдёт, предыдущие останутся.",
    "",
    ...lines.flatMap((l) => l.lines),
  ].join("\n");
  if (wireLength(text) > MAX_LENGTH) return null;
  return {
    text,
    keyboard: {
      inline_keyboard: [[
        { text: "Да, применить", callback_data: `ic:y:${id}` },
        { text: "Назад", callback_data: `ic:b:${id}` },
      ]],
    },
  };
}

const RESULT_TITLES = {
  [STATUS.done]: "Предложение применено",
  [STATUS.partial]: "Предложение применено частично",
  [STATUS.failed]: "Предложение не применено",
  [STATUS.rejected]: "Предложение отклонено",
  [STATUS.expired]: "Предложение истекло",
};
// sweep счёл применение прервавшимся: итог неизвестен, часть операций могла пройти
const STUCK_TITLE = "Применение прервано — результат неизвестен";
const STUCK_HINT = "Проверьте технику в портале, прежде чем предлагать снова.";
const isStuck = (change) => change.stuck === true && change.status === STATUS.failed;
const resultTitle = (change) => (isStuck(change) ? STUCK_TITLE : RESULT_TITLES[change.status]) || "Предложение обработано";

// Строки итога операции: заголовок с отметкой и причиной, подстроки — как в предложении
function resultLines(op, stuck = false) {
  const { lines: [head, ...subs] } = operationBlock(op.text, "");
  const error = oneLine(op.result?.error, ERROR_MAX);
  const line = (() => {
    switch (op.result?.state) {
      case "done":
        return `✓ ${head}`;
      case "failed":
        return `✗ ${head}${error ? ` — ${error}` : ""}`;
      default:
        if (stuck) return `— ${head} — результат неизвестен`;
        // В error пропущенной строки — причина дрейфа: «изменилось после предложения»
        return `— ${head} — не выполнено${error ? `: ${error}` : ""}`;
    }
  })();
  return [line, ...subs];
}

function resultFor(change) {
  const lines = [resultTitle(change), quotedTitle(change)];
  if (change.status === STATUS.rejected) {
    const why = oneLine(change.decision?.comment, ERROR_MAX);
    if (why) lines.push(`Причина: ${why}`);
    return lines.join("\n");
  }
  if (change.status === STATUS.expired) return lines.join("\n");
  const ops = opsOf(change);
  const stuck = isStuck(change);
  const line = (op) => resultLines(op, stuck);
  if (ops.length) lines.push("", ...ops.flatMap(line));
  if (stuck) lines.push("", STUCK_HINT);
  const text = lines.join("\n");
  if (wireLength(text) <= MAX_LENGTH) return text;
  // Потолок Telegram: хвост списка заменяется счётчиком
  let count = ops.length;
  const compose = (n) => [...lines.slice(0, 3), ...ops.slice(0, n).flatMap(line), `…и ещё ${ops.length - n}`, ...(stuck ? ["", STUCK_HINT] : [])].join("\n");
  while (count > 0 && wireLength(compose(count)) > MAX_LENGTH) count--;
  return clamp(compose(count));
}

const expiredFor = (change) => `Предложение истекло: ${quotedTitle(change)}`;

/**
 * Что Telegram показывает сейчас — одно правило для уведомления, ручек бота и ответа агенту.
 * fits — сообщение целиком в потолке И шаг подтверждения тоже: только тогда кнопки решения.
 * Сообщение влезло, а подтверждение нет — к тексту добавляется оговорка про портал.
 * -> { text, keyboard, fits, confirm: { text, keyboard } | null }
 */
function present(change, { baseUrl, timezone } = {}) {
  const message = messageFor(change, { timezone });
  const confirm = message.fits ? confirmFor(change) : null;
  const fits = message.fits && confirm !== null;
  let { text } = message;
  if (message.fits && !fits) {
    const noted = `${message.text}\n\n${BIG_NOTE}`;
    text = wireLength(noted) <= MAX_LENGTH ? noted : messageFor(change, { timezone, big: true }).text;
  }
  return { text, keyboard: keyboardFor(change, fits, { baseUrl }), fits, confirm };
}

module.exports = { MAX_LENGTH, BIG_NOTE, messageFor, keyboardFor, linkKeyboard, confirmFor, present, resultFor, resultTitle, expiredFor, quotedTitle, mailUrl, oneLine, idOf, pathOf };
