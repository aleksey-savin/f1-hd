/**
 * Тексты «Диалогов»: подписи сетей и очередей, время строки списка, «ждёт …»,
 * мета строки, системные строки ленты, подписи вложений. Чистые функции —
 * тесты рядом: `node --test src/util/conversation-format.test.js`.
 *
 * Пояс показа приходит параметром (`timeZone`): util/format-date читает его из
 * localStorage и в тестах не грузится. Компоненты берут его из
 * `displayTimeZone()` того же util/format-date.
 */
import { plural } from "./plural.js";
import { formatPhone } from "./phone.ts";

/**
 * @typedef {{ now?: Date, timeZone?: string }} TimeOptions
 * @typedef {{ text?: string, ticket?: number }} LinePart
 */

/** Подписи сетей — те же, что у сервера (services/messaging/rules.js). */
export const NETWORK_LABEL = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  max: "MAX",
  site: "Форма с сайта",
};

export const networkLabel = (network) => NETWORK_LABEL[network] ?? "Мессенджер";

/** Очереди в порядке чипов; точка — только у «Ждут ответа» (канва A1). */
export const QUEUES = [
  { value: "awaiting", label: "Ждут ответа", dot: "warning" },
  { value: "mine", label: "Мои", dot: "none" },
  { value: "unbound", label: "Без заявки", dot: "none" },
  { value: "all", label: "Все", dot: "none" },
];

export const QUEUE_VALUES = QUEUES.map((queue) => queue.value);

const MINUTE = 60_000;

/** Сколько ждёт ответа: «12 мин», «1 ч 14 мин», «2 д 3 ч». Меньше минуты — «1 мин». */
export const waitLabel = (since, now = new Date()) => {
  if (!since) return "";
  const minutes = Math.max(
    1,
    Math.floor((new Date(now).getTime() - new Date(since).getTime()) / MINUTE),
  );
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} д ${restHours} ч` : `${days} д`;
};

const dayKeyOf = (date, timeZone) =>
  new Date(date).toLocaleDateString("en-CA", { timeZone });

const daysAgo = (date, now, timeZone) =>
  Math.round(
    (Date.parse(`${dayKeyOf(now, timeZone)}T00:00:00Z`) -
      Date.parse(`${dayKeyOf(date, timeZone)}T00:00:00Z`)) /
      86_400_000,
  );

/** «10:42» в поясе показа. */
export const timeOf = (date, timeZone) =>
  new Date(date).toLocaleTimeString("ru", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Время строки списка: сегодня — «10:42», вчера — «вчера», на неделе — «пн», раньше — «12.09».
 * @param {string | Date | null | undefined} at
 * @param {TimeOptions} [options]
 */
export const listTimeLabel = (at, { now = new Date(), timeZone } = {}) => {
  if (!at) return "";
  const days = daysAgo(at, now, timeZone);
  if (days <= 0) return timeOf(at, timeZone);
  if (days === 1) return "вчера";
  if (days < 7) {
    return new Date(at).toLocaleDateString("ru", { timeZone, weekday: "short" });
  }
  return new Date(at).toLocaleDateString("ru", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  });
};

/**
 * Метка дня над сообщениями: «Сегодня», «Вчера», «27 июля».
 * @param {string | Date} at
 * @param {TimeOptions} [options]
 */
export const dayLabel = (at, { now = new Date(), timeZone } = {}) => {
  const days = daysAgo(at, now, timeZone);
  if (days <= 0) return "Сегодня";
  if (days === 1) return "Вчера";
  return new Date(at).toLocaleDateString("ru", {
    timeZone,
    day: "numeric",
    month: "long",
  });
};

/**
 * Кто сказал последнее слово — подпись перед превью в строке списка: «Вы»,
 * «с телефона», имя автора в группе. У входящего в личном чате подписи нет.
 * @param {{ direction: string, origin: string, authorName: string } | null | undefined} lastMessage
 * @param {{ kind?: string, myName?: string }} [options]
 * @returns {string}
 */
export const lastMessagePrefix = (lastMessage, { kind, myName } = {}) => {
  if (!lastMessage) return "";
  if (lastMessage.direction === "out") {
    if (lastMessage.origin === "device") return "с телефона";
    if (lastMessage.authorName && lastMessage.authorName === myName) return "Вы";
    return lastMessage.authorName || "";
  }
  if (lastMessage.direction === "in" && kind === "group") {
    return lastMessage.authorName || "";
  }
  return "";
};

export const unknownLabel = (network) =>
  network === "whatsapp" ? "неизвестный номер" : "неизвестный контакт";

/**
 * Третья строка списка: компания (или «Форма с сайта») и номер заявки; без
 * заявки — «без заявки», у неопознанного личного чата — «неизвестный …».
 * Возвращает части с тоном: `muted` — факт, `faint` — отсутствие факта.
 * @param {{ kind: string, network: string, unknown: boolean, company: { alias: string } | null, ticket: { num: number } | null }} row
 * @returns {Array<{ text: string, tone: "muted" | "faint" }>}
 */
export const rowMeta = (row) => {
  const parts = [];
  if (row.kind === "form") {
    parts.push({ text: row.company?.alias || NETWORK_LABEL.site, tone: "muted" });
  } else if (row.company) {
    parts.push({ text: row.company.alias, tone: "muted" });
  }
  if (row.ticket) {
    parts.push({ text: `№${row.ticket.num}`, tone: "muted" });
  } else if (row.unknown && row.kind === "direct") {
    parts.push({ text: unknownLabel(row.network), tone: "faint" });
  } else {
    parts.push({ text: "без заявки", tone: "faint" });
  }
  return parts;
};

/**
 * Пустой список — по очереди, фильтру «Скрытые» и поиску.
 * @param {{ queue?: string, hidden?: boolean, q?: string }} [options]
 * @returns {string}
 */
export const emptyListText = ({ queue, hidden = false, q = "" } = {}) => {
  if (q.trim()) return "Ничего не нашлось";
  if (hidden) return "Скрытых диалогов нет";
  const byQueue = {
    awaiting: "Никто не ждёт ответа",
    mine: "Ваших диалогов нет",
    unbound: "Все диалоги привязаны к заявкам",
    all: "Диалогов пока нет",
  };
  return byQueue[queue] ?? "Диалогов нет";
};

/** «Соколова Марина» → «Соколова М.» — подпись кнопки «Ответить через». */
export const shortPersonName = (name) => {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[1][0]}.`;
};

/**
 * Имя из мессенджера → поля формы пользователя. Мессенджеры пишут имя первым
 * («Андрей Кузнецов»), форма хранит фамилию и имя порознь.
 */
export const splitPersonName = (name) => {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
};

/**
 * «привязана с 10:03» сегодня, «привязана с 12.09» раньше.
 * @param {string | Date | null | undefined} boundAt
 * @param {TimeOptions} [options]
 */
export const boundSinceLabel = (boundAt, { now = new Date(), timeZone } = {}) => {
  if (!boundAt) return "";
  const days = daysAgo(boundAt, now, timeZone);
  const when =
    days <= 0
      ? timeOf(boundAt, timeZone)
      : new Date(boundAt).toLocaleDateString("ru", {
          timeZone,
          day: "2-digit",
          month: "2-digit",
        });
  return `привязана с ${when}`;
};

/**
 * Системная строка ленты частями: `{ text }` — текст, `{ ticket }` — номер
 * заявки ссылкой. Подписи безличные («Создана заявка»), как у событий
 * хроники: пола автора мы не знаем. `compact` — короткая форма для телефона.
 * @param {{ kind?: string, ticketNum?: number | null, byName?: string, targetName?: string, count?: number | null } | null | undefined} event
 * @param {{ compact?: boolean }} [options]
 * @returns {LinePart[]}
 */
export const systemLineParts = (event, { compact = false } = {}) => {
  const by = event?.byName ? ` · ${event.byName}` : "";
  const num = event?.ticketNum ?? null;
  const ticket = num === null ? { text: "" } : { ticket: num };
  switch (event?.kind) {
    case "ticketCreated":
      return compact
        ? [{ text: "Создана заявка " }, ticket, { text: " — переписка идёт в неё" }]
        : [
            { text: "Создана заявка " },
            ticket,
            { text: ` — дальше переписка идёт в неё${by}` },
          ];
    case "bound":
      return [{ text: "Диалог привязан к заявке " }, ticket, { text: by }];
    case "unbound":
      return [{ text: "Диалог отвязан от заявки " }, ticket, { text: by }];
    case "bindingEnded":
      return [
        { text: "Заявка " },
        ticket,
        { text: " закрыта — диалог больше не привязан" },
      ];
    case "bindingRestored":
      return [
        { text: "Заявку " },
        ticket,
        { text: " вернули в работу — переписка снова идёт в неё" },
      ];
    case "handled":
      return [{ text: `Ответ не нужен${by}` }];
    case "assigned":
      return [
        {
          text: event.targetName
            ? `Ответственный за диалог — ${event.targetName}${by}`
            : `Ответственный за диалог снят${by}`,
        },
      ];
    case "attached": {
      const count = event.count ?? 0;
      return [
        {
          text: `${count} ${plural(count, "сообщение добавлено", "сообщения добавлены", "сообщений добавлено")} в заявку `,
        },
        ticket,
        { text: by },
      ];
    }
    default:
      return [{ text: "Событие диалога" }];
  }
};

/** «1,8 МБ», «240 КБ»; нет размера — пустая строка. */
export const formatFileSize = (bytes) => {
  const size = Number(bytes) || 0;
  if (size <= 0) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
};

/** Длительность голосового: 14 → «0:14», 75 → «1:15». */
export const voiceDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Вид вложения словом — подпись заглушки, пока файла нет. */
export const attachmentKindLabel = (kind) =>
  ({
    photo: "Фото",
    voice: "Голосовое",
    audio: "Аудио",
    video: "Видео",
    sticker: "Стикер",
  })[kind] ?? "Файл";

/** Ник или телефон собеседника — вторая строка в шапке и строке канала. */
export const counterpartHandle = (person) =>
  person?.username ? `@${person.username}` : formatPhone(person?.phone);

/** Ручка канала из карточки собеседника («@ник» или телефон цифрами) — для показа. */
export const handleLabel = (handle) =>
  !handle || handle.startsWith("@") ? handle || "" : formatPhone(handle);

/** Первая строка ленты неопознанного собеседника (канва C2). */
export const newCounterpartNote = (network) =>
  network === "whatsapp"
    ? "Новый собеседник — этого номера нет ни у пользователей, ни у компаний"
    : "Новый собеседник — этого аккаунта нет ни у пользователей, ни у компаний";

/** Пояснение панели «Кто это?» (канва C2). */
export const linkAdvice = (network) =>
  `Свяжите ${network === "whatsapp" ? "номер" : "аккаунт"} с пользователем — дальше его сообщения будут узнаваться сами, а заявка получит компанию и инициатора.`;

/** Подсказка в поле ответа на десктопе (канва A1). */
export const composerPlaceholder = (network, ticketNum) =>
  ticketNum
    ? `Сообщение в ${networkLabel(network)} — попадёт в заявку №${ticketNum}`
    : `Сообщение в ${networkLabel(network)}`;

/** Строка над полем ответа на телефоне (канва B2). */
export const phoneComposerHint = (network, ticketNum) =>
  ticketNum
    ? `Ответ уйдёт в ${networkLabel(network)} и попадёт в заявку №${ticketNum}`
    : `Ответ уйдёт в ${networkLabel(network)}`;
