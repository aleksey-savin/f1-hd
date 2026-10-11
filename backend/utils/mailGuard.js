const logger = require("./logger");

/**
 * Режим почты: куда на самом деле уходят письма этой установки.
 *
 * Задаётся переменной окружения `MAIL_MODE`:
 *  - `live`    — письма уходят настоящим получателям;
 *  - `sandbox` — ВСЕ письма уходят на `MAIL_SANDBOX_RECIPIENT`, тема помечена,
 *                исходный адрес сохраняется (стенд на копии боевой базы: в ней
 *                живые адреса клиентов и боевой SMTP);
 *  - `off`     — письма не отправляются вовсе.
 *
 * Не задано — значит `off`. Ошибаться режим должен в сторону «письмо не ушло
 * клиенту»: выключенную почту заметят в тот же день, утёкшее письмо не
 * отзовёшь. По той же причине неизвестное значение и песочница без адреса
 * дают `off`, а сервер с такой настройкой не запускается (`assertMailConfig`).
 *
 * `NODE_ENV` на почту не влияет, встроенного адреса нет.
 *
 * Защита стоит в двух местах: в модели уведомления (подмена адреса при
 * создании документа) и в `services/mail/send.js` — у самой отправки.
 */

const MODES = ["live", "sandbox", "off"];

/** Отказ отправки в режиме `off` — для очереди и для кнопки проверки. */
const MAIL_OFF_FAILURE = Object.freeze({
  state: "Отправка почты выключена на сервере",
  hint: "Включается в настройках сервера: MAIL_MODE=live.",
});

/**
 * Разбор окружения. Читается при каждом вызове: режим можно проверить тестом,
 * а значение не залипает в модуле.
 *
 * @returns {{ mode: "live"|"sandbox"|"off", sandboxRecipient: string|null, error: string|null }}
 */
const readConfig = () => {
  const raw = (process.env.MAIL_MODE || "").trim().toLowerCase();
  const sandboxRecipient = (process.env.MAIL_SANDBOX_RECIPIENT || "").trim();

  if (!raw) {
    return { mode: "off", sandboxRecipient: null, error: null };
  }
  if (!MODES.includes(raw)) {
    return {
      mode: "off",
      sandboxRecipient: null,
      error: `Неизвестное значение MAIL_MODE: "${process.env.MAIL_MODE}". Допустимо: live, sandbox, off.`,
    };
  }
  if (raw === "sandbox" && !sandboxRecipient) {
    return {
      mode: "off",
      sandboxRecipient: null,
      error:
        "MAIL_MODE=sandbox требует MAIL_SANDBOX_RECIPIENT — адрес, на который уходит вся почта.",
    };
  }
  return {
    mode: raw,
    sandboxRecipient: raw === "sandbox" ? sandboxRecipient : null,
    error: null,
  };
};

/** @returns {"live"|"sandbox"|"off"} — читает env при каждом вызове */
const mailMode = () => readConfig().mode;

/**
 * Проверка настройки на старте сервера. Бросает Error с понятным текстом:
 * неизвестное значение MAIL_MODE или sandbox без MAIL_SANDBOX_RECIPIENT.
 */
const assertMailConfig = () => {
  const { error } = readConfig();
  if (error) {
    throw new Error(error);
  }
};

/**
 * Куда на самом деле уйдёт письмо:
 * live → тот же адрес; sandbox → адрес песочницы; off → null (никуда).
 */
const guardRecipient = (email, context = {}) => {
  const { mode, sandboxRecipient } = readConfig();
  if (mode === "off") {
    return null;
  }
  if (mode === "live" || !email || email === sandboxRecipient) {
    return email;
  }
  logger.log("warn", "Mail recipient redirected (sandbox)", {
    ...context,
    intended: email,
    actual: sandboxRecipient,
  });
  return sandboxRecipient;
};

/** Пометка в теме, чтобы письмо песочницы нельзя было спутать с боевым. */
const guardSubject = (subject, intendedEmail) =>
  mailMode() === "sandbox"
    ? `[SANDBOX → ${intendedEmail || "?"}] ${subject || ""}`.trim()
    : subject;

/**
 * Может ли письмо уйти на самом деле: почта включена в настройках И не
 * выключена на сервере. Этим флагом экраны решают, предлагать ли человеку путь,
 * который кончается письмом (код для входа, ссылка на смену пароля,
 * приглашение). Сам рубильник в форме настроек показывает своё значение из
 * базы — режим сервера там подписан отдельно.
 */
const mailCanSend = (preferences) =>
  mailMode() !== "off" && Boolean(preferences?.notify?.byEmail?.isActive);

/** { mode, sandboxRecipient } для интерфейса настроек. */
const describeMailMode = () => {
  const { mode, sandboxRecipient } = readConfig();
  return { mode, sandboxRecipient };
};

// Режим виден в первых строках лога: если почта выключена или уходит в
// песочницу, это заметят сразу, а не по жалобам клиентов
{
  const { mode, sandboxRecipient, error } = readConfig();
  const lines = {
    live: "Mail mode LIVE: письма уходят настоящим получателям",
    sandbox: `Mail mode SANDBOX: ВСЕ письма уходят только на ${sandboxRecipient}`,
    off: "Mail mode OFF: письма не отправляются (MAIL_MODE=live включает отправку)",
  };
  logger.log(
    error ? "error" : mode === "live" ? "info" : "warn",
    error ? `Mail mode: ${error}` : lines[mode],
    { module: "mailGuard", mailMode: mode },
  );
}

module.exports = {
  MAIL_OFF_FAILURE,
  mailMode,
  assertMailConfig,
  guardRecipient,
  guardSubject,
  mailCanSend,
  describeMailMode,
};
