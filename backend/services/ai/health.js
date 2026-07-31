const Preferences = require("@/models/preferences");
const logger = require("@/utils/logger");

// Состояние каналов ИИ: чат-провайдер и распознавание речи. Пишут настоящие
// вызовы (руководство по заявке, подбор категории, расшифровка аудио) и кнопки
// проверки в настройках; читает строка состояния секции (app/HealthRow).
//
// Троттлинга, как у почтового собрата (services/mail/health.js), здесь нет
// намеренно: там крон сбора ходит раз в 20 секунд и залил бы базу одинаковыми
// апдейтами, а к ИИ обращаются штучно — по заявке.
const AI = "ai.health";
const SPEECH = "ai.speechToText.health";

// Запись состояния — побочный эффект: если она не удалась, вызов ИИ всё равно
// состоялся и его результат важнее строки в настройках.
const write = async (path, update) => {
  try {
    await Preferences.updateOne({}, update);
  } catch (error) {
    logger.log("warn", "Failed to record AI channel health", {
      path,
      error: error.message,
    });
  }
};

// message — канал не просто ответил, а сделал свою работу: вернул разобранный
// ответ модели или расшифровку. Проверка кнопкой такого факта не даёт.
const recordOk = (path, { message = false } = {}) => {
  const now = new Date();

  return write(path, {
    $set: {
      [`${path}.lastCheckedAt`]: now,
      [`${path}.lastOkAt`]: now,
      [`${path}.lastError`]: "",
      [`${path}.lastErrorHint`]: "",
      [`${path}.lastErrorAt`]: null,
      [`${path}.consecutiveFailures`]: 0,
      ...(message ? { [`${path}.lastMessageAt`]: now } : {}),
    },
  });
};

// state/hint — пара фраз от describeAiError: «что случилось» и «что делать».
const recordError = (path, { state, hint = "" }) => {
  const now = new Date();

  return write(path, {
    $set: {
      [`${path}.lastCheckedAt`]: now,
      [`${path}.lastError`]: state,
      [`${path}.lastErrorHint`]: hint,
      [`${path}.lastErrorAt`]: now,
    },
    $inc: { [`${path}.consecutiveFailures`]: 1 },
  });
};

module.exports = { AI, SPEECH, recordOk, recordError };
