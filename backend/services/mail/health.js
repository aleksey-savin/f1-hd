const Preferences = require("../../models/preferences");

// Запись состояния почтового канала. Пишут трое — крон сбора, ручная проверка
// из настроек и services/mail/outbox при отправке уведомлений; читает строка
// в секции настроек.
//
// ВНИМАНИЕ: файл существует в двух точных копиях — backend/services/mail и
// telegram-bot/services/mail; копия ушла вместе с ботом, файл теперь один.
const MAILBOX = "mailbox.health";
const SMTP = "notify.byEmail.health";

// Крон сбора ходит раз в 20 секунд: писать «всё хорошо» на каждый заход — это
// 4 тысячи одинаковых апдейтов в сутки. Успех без событий записываем не чаще
// раза в минуту, но переход из ошибки в норму и реально забранное письмо
// фиксируем немедленно — иначе строка состояния врёт.
const WRITE_INTERVAL_MS = 60 * 1000;
const lastOkWrite = new Map();
const lastErrorWrite = new Map();
const lastErrorText = new Map();
const lastKnownState = new Map();

const recordOk = async (path, { message = false } = {}) => {
  const now = new Date();
  const recoveredFromError = lastKnownState.get(path) === "error";
  const dueByTime =
    now.getTime() - (lastOkWrite.get(path) || 0) >= WRITE_INTERVAL_MS;

  lastKnownState.set(path, "ok");
  lastErrorText.delete(path);
  if (!message && !recoveredFromError && !dueByTime) {
    return;
  }
  lastOkWrite.set(path, now.getTime());

  await Preferences.updateOne(
    {},
    {
      $set: {
        [`${path}.lastCheckedAt`]: now,
        [`${path}.lastOkAt`]: now,
        [`${path}.lastError`]: "",
        [`${path}.lastErrorHint`]: "",
        [`${path}.lastErrorAt`]: null,
        [`${path}.consecutiveFailures`]: 0,
        // Канал реально сработал — забрал или отправил письмо
        ...(message ? { [`${path}.lastMessageAt`]: now } : {}),
      },
    },
  );
};

// state/hint — результат describeMailError (или своя пара фраз для причин, не
// связанных с соединением: например, «не выбран инициатор по умолчанию»).
//
// Лежащий сервер даёт ту же ошибку каждые 20 секунд — повторную пишем не чаще
// раза в минуту (сменившаяся формулировка записывается сразу). Поэтому
// consecutiveFailures считает ЗАПИСАННЫЕ неудачи, а не все попытки: он нужен
// как «давно ли и насколько стабильно сломано», а не как точный счётчик.
const recordError = async (path, { state, hint = "" }) => {
  const now = new Date();
  const wasOk = lastKnownState.get(path) !== "error";
  const sameText = lastErrorText.get(path) === state;
  const dueByTime =
    now.getTime() - (lastErrorWrite.get(path) || 0) >= WRITE_INTERVAL_MS;

  lastKnownState.set(path, "error");
  lastErrorText.set(path, state);
  lastOkWrite.delete(path);

  if (!wasOk && sameText && !dueByTime) {
    return;
  }
  lastErrorWrite.set(path, now.getTime());

  await Preferences.updateOne(
    {},
    {
      $set: {
        [`${path}.lastCheckedAt`]: now,
        [`${path}.lastError`]: state,
        [`${path}.lastErrorHint`]: hint,
        [`${path}.lastErrorAt`]: now,
      },
      $inc: { [`${path}.consecutiveFailures`]: 1 },
    },
  );
};

module.exports = { MAILBOX, SMTP, recordOk, recordError };
