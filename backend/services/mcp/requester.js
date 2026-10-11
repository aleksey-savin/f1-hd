/**
 * Человек, от имени которого агент пишет в HD (запрос на изменение Mikrotik,
 * заметка базы знаний): агент передаёт его Telegram id.
 *
 * Сотрудник (не клиент, не служебная учётка), не заблокирован, Telegram
 * привязан и активен. Двое с одним id — отказ: агент не выбирает сам.
 */
const TELEGRAM_ID = /^\d{1,20}$/;

const pickRequester = (users, telegramId, isBanned) => {
  const fit = (users || []).filter(
    (user) =>
      user.isEndUser === false &&
      user.isServiceAccount !== true &&
      user.telegramBot?.isActive === true &&
      String(user.telegramBot?.chatId) === String(telegramId) &&
      !isBanned(user),
  );
  if (fit.length > 1) return { error: "more than one employee has this Telegram id" };
  return fit[0] || null;
};

// Модели подключаются при вызове: модуль проверяется на заготовках без базы
const findStaffByTelegram = async (telegramId) => {
  const User = require("@/models/user");
  const { isBanned } = require("@/services/authBan");
  const users = await User.find({
    "telegramBot.chatId": String(telegramId),
    "telegramBot.isActive": true,
    isEndUser: false,
    isServiceAccount: { $ne: true },
  })
    .limit(10)
    .lean();
  return pickRequester(users, telegramId, isBanned);
};

module.exports = { TELEGRAM_ID, pickRequester, findStaffByTelegram };
