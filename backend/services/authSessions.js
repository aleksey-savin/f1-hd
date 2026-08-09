const mongoose = require("mongoose");

/**
 * Отзыв сессий — прямым запросом к коллекции better-auth, а не через `auth.api`.
 *
 * Его ручки рассчитаны на «я гашу СВОИ сессии»: им нужны заголовки запроса, то
 * есть чужая сессия из контроллера или из крона так не гасится. Нам же нужно
 * ровно обратное: администратор отключает учётку, компания уходит в архив,
 * пароль сброшен — и всё это должно немедленно выкинуть человека отовсюду.
 *
 * До появления better-auth отзыва не существовало вовсе: выход был
 * `localStorage.removeItem` на клиенте, а выданный JWT жил свои четырнадцать
 * дней.
 */

const collection = () => mongoose.connection.db.collection("authSessions");

/**
 * userId в документах адаптера — ObjectId, но версия адаптера может изменить
 * форму, и односторонний фильтр тогда молча перестал бы что-либо гасить.
 * Ищем обоими способами: лишнее условие стоит ничего, а тихо не сработавший
 * отзыв доступа — дорого.
 */
const byUser = (userId) => {
  const id = String(userId);
  const conditions = [{ userId: id }];
  if (mongoose.isValidObjectId(id)) {
    conditions.push({ userId: new mongoose.Types.ObjectId(id) });
  }
  return { $or: conditions };
};

/** Погасить все сеансы человека. Возвращает число снятых. */
const revokeAllForUser = async (userId) => {
  const { deletedCount } = await collection().deleteMany(byUser(userId));
  return deletedCount;
};

/** Погасить все сеансы, кроме текущего — для «выйти на остальных устройствах». */
const revokeOthersForUser = async (userId, keepToken) => {
  const { deletedCount } = await collection().deleteMany({
    ...byUser(userId),
    token: { $ne: keepToken },
  });
  return deletedCount;
};

/** Погасить сеансы всех сотрудников компании — каскад от `company.toggleActive`. */
const revokeAllForCompany = async (companyId) => {
  const User = require("@/models/user");
  const users = await User.find({ "company._id": companyId })
    .select("_id")
    .lean();
  let total = 0;
  for (const user of users) {
    total += await revokeAllForUser(user._id);
  }
  return total;
};

/** Список активных сеансов человека — для раздела «Активные сеансы». */
const listForUser = async (userId) =>
  collection()
    .find(byUser(userId))
    .project({ token: 0 })
    .sort({ updatedAt: -1 })
    .toArray();

module.exports = {
  revokeAllForUser,
  revokeOthersForUser,
  revokeAllForCompany,
  listForUser,
};
