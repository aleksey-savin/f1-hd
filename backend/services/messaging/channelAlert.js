/**
 * Колокольчик администраторам, когда канал «Диалогов» перестал работать
 * (спека, «Risks»: блокировка и выход — состояние канала и оповещение;
 * потеря сессии — «Завершить другие сеансы» в Telegram, правило 14 дней у
 * WhatsApp). Шлюз сообщает это событием `channel.state`; ingest.js пишет
 * состояние условно по прежнему (compare-and-set) и зовёт alertChannelState,
 * только если решение ниже сказало «да» — повтор события, повторная доставка
 * и гонка двух доставок колокольчик второй раз не будят.
 *
 * Кому: каждому, кто может открыть настройки каналов (`settings.manage`),
 * кроме отключённых и служебных учёток. Категория — `conversationMessage`:
 * системной категории нет, а эта — тот же модуль «Диалоги» и тот же канал
 * доставки «только в приложении». Модуль «Диалоги» не проверяется: каналы
 * подключают и до его включения, а ссылка ведёт в настройки, которые
 * получателю открыты всегда.
 *
 * Чистые функции — тесты рядом: `node --test services/messaging/channelAlert.test.js`.
 */

/** Состояния, о входе в которые сообщаем. */
const ALERT_STATES = new Set(["loggedOut", "banned", "error"]);

// «error» шлюз сообщает и после минуты без связи с мессенджером («Нет связи
// с Telegram — переподключаемся»), а сеть может «моргать» — об этом не чаще
// раза в 6 часов на канал. loggedOut и banned сами не повторяются: между ними
// всегда новый вход человеком
const ERROR_REPEAT_MS = 6 * 60 * 60 * 1000;

/** Секция «Каналы связи» в «Настройках системы» (pages/Preferences, id `channels`). */
const CHANNEL_SETTINGS_LINK = "/preferences#channels";

/**
 * Будить ли колокольчик на этот переход.
 * @param {{ previous?: string | null, next: string, active?: boolean, errorAlertedAt?: Date | string | null, now?: Date }} input
 * @returns {boolean}
 */
const shouldAlertChannelState = ({ previous = null, next, active = true, errorAlertedAt = null, now = new Date() }) => {
  // Выключенный канал человек отключил сам — его сбои никого не ждут
  if (active === false) return false;
  if (!ALERT_STATES.has(next) || previous === next) return false;
  if (next !== "error" || !errorAlertedAt) return true;
  return now.getTime() - new Date(errorAlertedAt).getTime() >= ERROR_REPEAT_MS;
};

const STATE_TITLE = {
  loggedOut: "сессия завершена",
  banned: "аккаунт заблокирован",
  error: "нет подключения",
};

const STATE_HINT = {
  loggedOut: "Войдите заново в «Настройки системы → Каналы связи» — переписка сохранится",
  banned: "Мессенджер ограничил аккаунт — сообщения не принимаются и не отправляются",
  error: "Сообщения не принимаются, пока канал не подключится",
};

/**
 * Строка колокольчика: имя канала и причина от шлюза. Телефона и ника
 * корпоративного аккаунта в ней нет — только названия.
 * @param {{ name?: string } | null | undefined} channel
 * @param {string} state
 * @param {string} [reason]
 * @returns {{ title: string, text: string }}
 */
const channelAlertText = (channel, state, reason = "") => ({
  title: `Канал «${channel?.name || "Мессенджер"}»: ${STATE_TITLE[state] || "сбой"}`,
  text: String(reason || "").trim() || STATE_HINT[state] || "",
});

const USER_FIELDS = "_id firstName lastName notify isServiceAccount isEndUser banned banExpires";

/**
 * Разослать колокольчик. Состояние к этому моменту уже записано, поэтому сбой
 * рассылки не пробрасывается: иначе шлюз повторил бы событие, а повтор — уже
 * не переход. Возвращает число легших строк (0 — никому или сбой).
 * @param {{ channel: { _id: unknown, name?: string }, state: string, reason?: string }} input
 * @returns {Promise<number>}
 */
const alertChannelState = async ({ channel, state, reason = "" }) => {
  try {
    const User = require("@/models/user");
    const { permissionFilter } = require("@/services/permissions");
    const { isBanned } = require("@/services/authBan");
    const { pushInApp } = require("@/services/inAppNotifications");
    const canManage = await permissionFilter("settings.manage");
    const users = await User.find({ $and: [canManage, { isServiceAccount: { $ne: true } }] })
      .select(USER_FIELDS)
      .lean();
    const { title, text } = channelAlertText(channel, state, reason);
    return await pushInApp({
      // Срок отключения смотрит isBanned, а не сырой banned
      recipients: users.filter((user) => !isBanned(user)),
      category: "conversationMessage",
      kind: "channelState",
      title,
      text,
      link: CHANNEL_SETTINGS_LINK,
    });
  } catch (error) {
    require("@/utils/logger").log("error", "Channel state alert failed", {
      channelId: String(channel?._id ?? ""),
      state,
      error: error?.message,
    });
    return 0;
  }
};

module.exports = {
  ALERT_STATES,
  ERROR_REPEAT_MS,
  CHANNEL_SETTINGS_LINK,
  shouldAlertChannelState,
  channelAlertText,
  alertChannelState,
};
