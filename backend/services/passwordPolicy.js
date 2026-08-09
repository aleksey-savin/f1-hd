const crypto = require("crypto");

const logger = require("@/utils/logger");
const { getAuth } = require("@/auth/bootstrap");

/**
 * Проверка пароля по спискам утечек — ЕДИНСТВЕННАЯ в приложении.
 *
 * Штатный плагин `haveibeenpwned` отсюда убран намеренно: при недоступном
 * сервисе он бросает 500 и пароль не принимает. На его ручках это `/reset-
 * password` — то есть человек, пришедший по ссылке из письма единственной
 * доступной ему дорогой, при простое чужого сервиса не смог бы задать пароль
 * вовсе. Наше правило обратное: не проверили — пропускаем и говорим об этом
 * вслух. Плагин заменён хуком `before` в auth/instance.mjs, который зовёт эту
 * же функцию, так что правило одно на все пути — и на наши, и на better-auth.
 *
 * K-анонимность: наружу уходят первые пять символов SHA1, ответ содержит
 * хвосты всех хешей с таким префиксом. Сам пароль сервер не покидает.
 */
const HIBP_RANGE = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 3000;

/**
 * @returns {Promise<{checked: boolean, breached: boolean, count: number}>}
 *   `checked: false` — сервис не ответил. Пароль в этом случае ПРОПУСКАЕМ:
 *   запереть администратора из-за простоя чужого сервиса хуже, чем пропустить
 *   одну проверку. Факт пропуска пишем в журнал, чтобы это не было тихо.
 */
const checkBreached = async (plainPassword) => {
  const sha1 = crypto
    .createHash("sha1")
    .update(String(plainPassword))
    .digest("hex")
    .toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const response = await fetch(HIBP_RANGE + prefix, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Add-Padding": "true" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const body = await response.text();
    const hit = body
      .split("\n")
      .find((line) => line.slice(0, suffix.length).toUpperCase() === suffix);

    if (!hit) {
      return { checked: true, breached: false, count: 0 };
    }
    return {
      checked: true,
      breached: true,
      count: Number(hit.split(":")[1]) || 0,
    };
  } catch (error) {
    logger.log("warn", "Проверка пароля по базе утечек не выполнена", {
      error: error.message,
    });
    return { checked: false, breached: false, count: 0 };
  }
};

/**
 * Отказ формулируется В ОДНОМ месте: одно и то же число человек видит и в
 * живой подсказке под полем, и в отказе сервера — иначе они разъедутся
 * формулировкой, и будет казаться, что это две разные проверки.
 */
const breachMessage = (count) =>
  `Этот пароль встречается в известных утечках (${count.toLocaleString("ru-RU")} раз) — возьмите другой.`;

/** Требования к длине — из конфигурации better-auth, не своей константой. */
const policy = async () => {
  const ctx = await getAuth().$context;
  return {
    minLength: ctx.password.config.minPasswordLength,
    maxLength: ctx.password.config.maxPasswordLength,
  };
};

module.exports = { checkBreached, breachMessage, policy };
