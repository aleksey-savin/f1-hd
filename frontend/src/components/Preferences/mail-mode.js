// Режим почты на сервере (MAIL_MODE) → строка состояния канала SMTP в
// «Уведомлениях». Режим задаётся окружением, а не настройками: строка его
// объясняет и в режиме `off` ничего не предлагает нажать.
//
// Чистый модуль без импортов: `channel-health.js` тянет `util/format-date`
// (браузерные зависимости) и под `node --test` не грузится.

// Текст отказа отправки в режиме `off`. ДОЛЖЕН совпадать с
// `MAIL_OFF_FAILURE.state` в backend/utils/mailGuard.js: бэкенд пишет его в
// состояние канала, и по нему же здесь узнаётся устаревшая запись.
export const MAIL_OFF_STATE = "Отправка почты выключена на сервере";

/**
 * Пропсы app/HealthRow для режимов `sandbox` и `off`; `null` — обычная работа
 * (`live`, а также ответ без режима), строку рисует состояние канала.
 * `canCheck: false` — кнопки проверки у строки нет.
 */
export const describeMailMode = (mailMode) => {
  if (mailMode?.mode === "sandbox") {
    return {
      state: "warning",
      title: `Песочница: вся почта уходит на ${mailMode.sandboxRecipient || "адрес песочницы"}`,
      hint: "Режим задан на сервере. Настоящие адресаты писем не получают.",
      canCheck: true,
    };
  }

  if (mailMode?.mode === "off") {
    return {
      state: "idle",
      title: MAIL_OFF_STATE,
      hint: "Письма не уходят, уведомления помечаются неотправленными. Включается в настройках сервера.",
      canCheck: false,
    };
  }

  return null;
};

// Фраза с точкой на конце — чтобы склеить её со следующей в одну строку
const sentence = (text) => {
  const trimmed = typeof text === "string" ? text.trim() : "";
  return trimmed && !/[.!?…]$/.test(trimmed) ? `${trimmed}.` : trimmed;
};

/**
 * Строка режима (`describeMailMode`) с исходом кнопки проверки. Заголовок и
 * тон остаются за режимом: в песочнице предупреждение «вся почта уходит на …»
 * не должно пропасть и сразу после тестового письма. Исход проверки идёт в
 * подсказку — сначала он, затем пояснение режима. Без исхода и там, где
 * проверки нет (`off`), строка режима отдаётся как есть.
 */
export const mailModeRowWithCheck = (row, testResult) => {
  const { state, title, hint } = row;
  if (!row.canCheck || !testResult) return { state, title, hint };

  return {
    state,
    title,
    hint: [sentence(testResult.state), sentence(testResult.hint), hint]
      .filter(Boolean)
      .join(" "),
  };
};

/**
 * Состояние канала без устаревшего отказа «почта выключена». Отказ остаётся в
 * базе до первой удачной отправки; когда сервер уже в режиме `live`, это не
 * текущее состояние — показываем то, что было известно до него.
 */
export const withoutStaleMailOff = (health) => {
  if (health?.lastError !== MAIL_OFF_STATE) return health;

  return { ...health, lastError: "", lastErrorHint: "", lastErrorAt: null };
};
