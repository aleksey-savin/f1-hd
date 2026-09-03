import {
  WORK_STATUSES,
  ON_SHIFT_STATUS_CODES,
  getWorkStatusMeta,
} from "../../util/work-statuses";
import {
  businessDayKey,
  formatDayMonth,
  formatTime,
} from "../../util/format-date";

// Единый расчёт присутствия сотрудника — один источник правды для строки
// списка, контакт-шторки, карточки, рейла статусов, блока «Команда сейчас» и
// подсказки в выборе ответственного (раньше формула была скопирована в каждом).
// Присутствие есть только у активного сотрудника: не клиент, не сервисный
// аккаунт, не телефония и не скрытый из статусов.
export function getPresence(user = {}) {
  const visible =
    !user.isEndUser &&
    !user.isServiceAccount &&
    !user.isCloudTelephony &&
    !user.hideWorkStatus &&
    !user.banned;

  const code = user.workStatus?.code;
  const meta = getWorkStatusMeta(code);
  const unset = !code || code === "unset";

  return {
    visible,
    meta,
    unset,
    note: user.workStatus?.note || "",
    // Цвет кольца аватара: только у заданного статуса, иначе обычная рамка.
    ringColor: visible && !unset ? meta.color : null,
  };
}

// «с HH:MM» для сегодняшних смен статуса, «с DD.MM» для более старых. «Сегодня»
// — день бизнес-таймзоны (табло общее для всей организации), а не браузера.
export const sinceLabel = (updatedAt) => {
  if (!updatedAt) {
    return "";
  }
  return businessDayKey(updatedAt) === businessDayKey()
    ? `с ${formatTime(updatedAt)}`
    : `с ${formatDayMonth(updatedAt)}`;
};

// «до HH:MM» / «до DD.MM HH:MM» — ближайшая смена по графику (user.nextShiftAt,
// считает автоматика статусов).
export const untilLabel = (nextShiftAt) =>
  businessDayKey(nextShiftAt) === businessDayKey()
    ? `до ${formatTime(nextShiftAt)}`
    : `до ${formatDayMonth(nextShiftAt)} ${formatTime(nextShiftAt)}`;

/**
 * Строка времени у статуса. Тому, кого нет, важнее когда он появится, чем с
 * какого момента исчез, — поэтому «до …» с ближайшей сменой; на смене —
 * по-прежнему «с HH:MM».
 *
 * Только для статуса, который поставила автоматика: у ручного «не на работе»
 * (форс-мажор) или больничного, выставленного руками, график ничего не знает —
 * когда вернётся, говорит заметка, а строка честно показывает, с какого
 * момента человека нет.
 */
export const timeLabel = (user, meta = getWorkStatusMeta(user.workStatus?.code)) => {
  const onShift = ON_SHIFT_STATUS_CODES.includes(meta.code);
  const automatic = user.workStatus?.auto !== false;
  if (!onShift && automatic && user.nextShiftAt) {
    return untilLabel(user.nextShiftAt);
  }
  return sinceLabel(user.workStatus?.updatedAt);
};

// «сегодня в 13:40», «вчера в 13:40», «03.09 в 13:40» — футер «Обновлено …»
export const updatedLabel = (date) => {
  const key = businessDayKey(date);
  const time = formatTime(date);
  if (key === businessDayKey()) return `сегодня в ${time}`;
  if (key === businessDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000))) {
    return `вчера в ${time}`;
  }
  return `${formatDayMonth(date)} в ${time}`;
};

/**
 * Одна строка присутствия для подсказок: «на выезде · у заказчика на Ленина»
 * — заметка ценнее времени, когда она есть; иначе «в офисе · с 09:12».
 */
export const presenceLine = (user) => {
  const meta = getWorkStatusMeta(user.workStatus?.code);
  const tail = user.workStatus?.note || timeLabel(user, meta);
  return tail ? `${meta.label} · ${tail}` : meta.label;
};

/** Группы в порядке каталога, только непустые: язык табло. */
export const groupByStatus = (users) =>
  WORK_STATUSES.map((status) => ({
    status,
    users: users.filter(
      (user) => (user.workStatus?.code || "unset") === status.code,
    ),
  })).filter((group) => group.users.length > 0);

/**
 * Сводка от доступности, а не от численности: «3 на связи · 2 на выезде»
 * отвечает на вопрос, ради которого смотрят на табло. Когда на связи никого,
 * говорим, когда появятся, — по ближайшей смене среди всех.
 */
export const availabilitySummary = (users) => {
  const code = (user) => user.workStatus?.code || "unset";
  const count = (predicate) => users.filter(predicate).length;
  const online = count((user) => ["office", "remote"].includes(code(user)));
  const trip = count((user) => code(user) === "trip");
  const lunch = count((user) => code(user) === "lunch");

  const parts = [];
  if (online) parts.push(`${online} на связи`);
  if (trip) parts.push(`${trip} на выезде`);
  if (lunch) parts.push(`${lunch} обед`);
  if (parts.length) return parts.join(" · ");

  const next = users
    .map((user) => (user.nextShiftAt ? new Date(user.nextShiftAt) : null))
    .filter((date) => date && date.valueOf() > Date.now())
    .sort((a, b) => a - b)[0];
  return next
    ? `никого на связи · смена ${untilLabel(next).replace(/^до /, "с ")}`
    : "никого на связи";
};
