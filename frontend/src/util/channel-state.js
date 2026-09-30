/**
 * Каналы «Диалогов» в настройках: состояние канала → строка состояния
 * (`app/HealthRow`), стадия входа в диалоге подключения, подписи. Чистые
 * функции — тесты рядом: `node --test src/util/channel-state.test.js`.
 *
 * Состояния канала пишет шлюз msg-gateway событием `channel.state`
 * (docs/messaging.md, «Events»). `ago` — формат «2 мин назад» передаёт
 * вызывающий (util/format-date#formatAgo), чтобы модуль грузился в тестах.
 */
import { plural } from "./plural.js";
import { formatPhone } from "./phone.ts";

/** Сигнала шлюза нет дольше этого — строка состояния предупреждает. */
export const GATEWAY_SILENCE_MS = 5 * 60_000;

/** «socks5://relay.f1lab.ru:1080» → «relay.f1lab.ru»; не адрес — пусто. */
export const proxyHost = (url) => {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** Включена ли загрузка истории (свитч «Загрузить историю за N дней»). */
export const historyEnabled = (settings) => (settings?.historyDays ?? 0) > 0;

const connectionHint = (channel) => {
  const host = proxyHost(channel.settings?.proxyUrl);
  const days = channel.settings?.historyDays ?? 0;
  const via = host ? `Через прокси ${host}` : "Без прокси";
  return days > 0
    ? `${via} · история загружена за ${days} ${plural(days, "день", "дня", "дней")}`
    : via;
};

/**
 * Строка состояния канала: `{ state, title, meta?, hint?, action? }` — пропсы
 * `app/HealthRow` плюс `action: "login"`, если человеку есть что сделать
 * («Показать QR»).
 * @param {import("../types/conversation").MessagingChannel | null | undefined} channel
 * @param {{ now?: Date, ago?: (date: string) => string | null }} [options]
 * @returns {{ state: "ok" | "error" | "warning" | "busy" | "idle", title: string, meta?: string, hint?: string, action?: "login" }}
 */
export const channelHealth = (channel, { now = new Date(), ago = () => "" } = {}) => {
  if (!channel) {
    return {
      state: "idle",
      title: "Не подключён",
      hint: "Войдите по QR-коду или коду из SMS",
    };
  }
  if (!channel.isActive) {
    return {
      state: "idle",
      title: "Отключён",
      hint: "Сообщения не принимаются и не отправляются",
    };
  }
  switch (channel.state) {
    case "connected": {
      const seenAt = channel.gatewaySeenAt ? new Date(channel.gatewaySeenAt) : null;
      if (!seenAt || new Date(now).getTime() - seenAt.getTime() > GATEWAY_SILENCE_MS) {
        return {
          state: "warning",
          title: "Шлюз не отвечает",
          meta: seenAt ? `последний сигнал ${ago(channel.gatewaySeenAt)}` : "сигнала не было",
          hint: "Сообщения не приходят, пока не запущен сервис msg-gateway",
        };
      }
      return {
        state: "ok",
        title: "Подключён",
        meta: channel.lastMessageAt ? `сообщение ${ago(channel.lastMessageAt)}` : undefined,
        hint: connectionHint(channel),
      };
    }
    case "connecting":
      return { state: "busy", title: "Подключается…" };
    case "awaitingQr":
    case "awaitingCode":
    case "awaitingPassword":
      return {
        state: "warning",
        title: "Нужен вход",
        hint: "Вход начат, но не завершён",
        action: "login",
      };
    case "loggedOut":
      return {
        state: "warning",
        title: "Сессия завершена",
        hint: channel.stateReason || "Войдите заново — переписка сохранится",
        action: "login",
      };
    case "banned":
      return {
        state: "error",
        title: "Аккаунт заблокирован",
        hint: channel.stateReason || "Telegram ограничил аккаунт",
      };
    case "error":
      return {
        state: "error",
        title: "Ошибка подключения",
        hint: channel.stateReason || "Проверьте прокси и войдите заново",
        action: "login",
      };
    default:
      return {
        state: "idle",
        title: "Не подключён",
        hint: "Войдите по QR-коду или коду из SMS",
        action: "login",
      };
  }
};

/**
 * Что показывать в левой колонке диалога входа:
 *   connected — аккаунт и «Выйти»;
 *   qr        — QR-код (есть `login.qr`);
 *   waiting   — вход начат, кода ещё нет;
 *   code      — поле кода из Telegram или SMS;
 *   password  — пароль двухэтапной проверки;
 *   idle      — «Получить QR-код» (не подключён, сессия кончилась, ошибка).
 * @param {import("../types/conversation").MessagingChannel | null | undefined} channel
 * @returns {"connected" | "qr" | "waiting" | "code" | "password" | "idle"}
 */
export const loginStage = (channel) => {
  switch (channel?.state) {
    case "connected":
      return "connected";
    case "awaitingQr":
      return channel.login?.qr ? "qr" : "waiting";
    case "connecting":
      return "waiting";
    case "awaitingCode":
      return "code";
    case "awaitingPassword":
      return "password";
    default:
      return "idle";
  }
};

/**
 * Шаг входа (телефон, код, пароль) ещё обрабатывается шлюзом. Для этих трёх
 * шагов бэкенд не пишет промежуточное состояние синхронно (только «start»
 * получает `connecting` сразу — controllers/channel.js#command), поэтому
 * «ничего не изменилось с отправки» и есть признак «ждём ответа». `since` —
 * снимок состояния и стадии входа диалог берёт сразу после того, как шаг
 * ушёл на сервер; как только они сдвинулись — шлюз шаг обработал (успешно
 * или с ошибкой, но это уже видно по новому состоянию).
 * @param {{ state: string, stage: string }} since — снимок на момент отправки шага
 * @param {import("../types/conversation").MessagingChannel | null | undefined} channel
 * @returns {boolean}
 */
export const loginStepPending = (since, channel) =>
  (channel?.state ?? null) === since.state && loginStage(channel) === since.stage;

/** Сколько секунд живёт QR-код; нет срока — null. */
export const qrSecondsLeft = (expiresAt, now = new Date()) =>
  expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - new Date(now).getTime()) / 1000))
    : null;

/** Подсказка свитча «Подписывать ответы»: пример подписи без контактов. */
export const signatureExample = (firstName, organization) => {
  const who = [firstName, organization].filter(Boolean).join(", ");
  return who ? `«— ${who}» — имя без контактов` : "Имя и организация — без контактов";
};

/**
 * Прокси-адрес с паролем внутри («scheme://user:pass@host») — пароль наружу,
 * в адресе остаётся «user@host»: он хранится отдельным секретом
 * (write-only `proxyPassword`), а не открытым текстом в `settings.proxyUrl`,
 * иначе он показался бы в этом же поле при следующем открытии диалога.
 * @param {string} url
 * @returns {{ url: string, password: string | null }}
 */
export const splitProxyPassword = (url) => {
  if (!url) return { url: url ?? "", password: null };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { url, password: null };
  }
  if (!parsed.password) return { url, password: null };
  const password = parsed.password;
  parsed.password = "";
  return { url: parsed.toString(), password };
};

/** Подсказка строки канала: название аккаунта и номер (канва E1). */
export const channelHint = (channel) => {
  const account = channel?.account ?? {};
  const handle =
    formatPhone(account.phone) ||
    (account.username ? `@${account.username}` : "");
  const parts = [account.displayName, handle].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Корпоративный аккаунт не подключён";
};
