import { formatAgo } from "../../util/format-date";

// Состояние почтового канала → пропсы app/HealthRow. Источник — группа health
// в настройках, которую пишут крон сбора, отправка уведомлений и кнопка
// проверки (backend/services/mail/health.js).
//
// Ошибка «свежее» последнего успеха — значит канал сейчас сломан; иначе
// показываем, что и когда в последний раз получилось.
export const describeChannelHealth = (health, { kind, hint }) => {
  const isSmtp = kind === "smtp";
  const okAt = health?.lastOkAt ? new Date(health.lastOkAt).getTime() : 0;
  const errorAt = health?.lastErrorAt
    ? new Date(health.lastErrorAt).getTime()
    : 0;

  if (health?.lastError && errorAt >= okAt) {
    return {
      state: "error",
      title: health.lastError,
      meta: errorAt ? ` · ${formatAgo(health.lastErrorAt)}` : "",
      hint: health.lastErrorHint || hint,
    };
  }

  if (!okAt) {
    return {
      state: "idle",
      title: "Проверка ещё не выполнялась",
      hint,
    };
  }

  if (isSmtp) {
    return health.lastMessageAt
      ? {
          state: "ok",
          title: "Письма уходят",
          meta: ` · последнее ${formatAgo(health.lastMessageAt)}`,
          hint,
        }
      : {
          state: "ok",
          title: "Связь с сервером есть",
          meta: ` · проверено ${formatAgo(health.lastOkAt)}`,
          hint,
        };
  }

  return {
    state: "ok",
    title: "Ящик доступен",
    meta: ` · проверено ${formatAgo(health.lastOkAt)}`,
    hint: health.lastMessageAt
      ? `Последнее письмо — ${formatAgo(health.lastMessageAt)}`
      : "Писем пока не приходило",
  };
};

// Результат кнопки проверки поверх сохранённого состояния: он свежее всего,
// что лежит в базе, поэтому показываем именно его — до перезагрузки страницы.
export const describeCheckResult = (result, { hint }) => ({
  state: result.ok ? "ok" : "error",
  title: result.state,
  meta: " · только что",
  hint: result.hint || hint,
});
