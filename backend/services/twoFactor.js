const mongoose = require("mongoose");

/**
 * Второй фактор: то, чего у плагина нет.
 *
 * Сам `twoFactor` умеет включать, выключать и проверять — но только СВОЙ, от
 * имени владельца учётной записи. Сценарий «человек потерял телефон, а
 * резервные коды не сохранил» он не закрывает: администраторской ручки сброса
 * в плагине нет вовсе.
 */

const collection = () =>
  mongoose.connection.db.collection("authTwoFactors");

/**
 * userId адаптер пишет ObjectId, но версия может изменить форму, и
 * односторонний фильтр тогда молча перестал бы что-либо находить — как и у
 * сессий, ищем обоими способами.
 */
const byUser = (userId) => {
  const id = String(userId);
  const conditions = [{ userId: id }];
  if (mongoose.isValidObjectId(id)) {
    conditions.push({ userId: new mongoose.Types.ObjectId(id) });
  }
  return { $or: conditions };
};

/** Включён ли второй фактор — по записи, а не по флагу в документе. */
const isEnabledFor = async (userId) =>
  (await collection().countDocuments(byUser(userId))) > 0;

/**
 * Сброс: секрет и резервные коды стираются, флаг снимается.
 *
 * Возвращает `true`, если что-то действительно было — иначе интерфейс
 * отрапортовал бы об успехе там, где сбрасывать было нечего.
 */
const reset = async (userId) => {
  const { deletedCount } = await collection().deleteMany(byUser(userId));

  await mongoose.connection.db
    .collection("users")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(String(userId)) },
      { $set: { twoFactorEnabled: false } },
    );

  return deletedCount > 0;
};

module.exports = { isEnabledFor, reset };
