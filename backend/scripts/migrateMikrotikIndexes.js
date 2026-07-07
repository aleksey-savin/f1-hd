const mongoose = require("mongoose");
const Mikrotik = require("../models/mikrotik");

// Разовая идемпотентная миграция индексов Mikrotik.
//
// Появились standalone-устройства (Cloud Hosted Router и т.п.) — записи без
// clientDevice. Обычный уникальный индекс clientDevice_1 считает отсутствующее
// значение как null и разрешает лишь одну такую запись. Нужен ПАРТИАЛ-уникальный
// индекс (уникальность только среди записей, реально ссылающихся на устройство:
// { clientDevice: { $exists: true } }).
//
// Mongoose НЕ меняет опции уже существующего индекса автоматически — старый
// clientDevice_1 нужно явно удалить, после чего syncIndexes() построит
// партиал-индекс из схемы. Запуск на проде:
//   docker exec hd-backend-prod node scripts/migrateMikrotikIndexes.js
async function migrate() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    // 1. Пред-проверка: дубли clientDevice сломают построение уникального индекса.
    const dupes = await Mikrotik.aggregate([
      { $match: { clientDevice: { $exists: true, $ne: null } } },
      { $group: { _id: "$clientDevice", count: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } },
    ]);
    if (dupes.length > 0) {
      console.error(
        "❌ Найдены дубли по clientDevice — миграция прервана. Устраните их и повторите:",
      );
      dupes.forEach((d) =>
        console.error(`   clientDevice=${d._id}: ${d.count} шт. (${d.ids.join(", ")})`),
      );
      return;
    }
    console.log("✅ Дубли clientDevice не найдены");

    // 2. Удаляем старый обычный уникальный индекс (best-effort — может
    //    отсутствовать или уже быть партиальным).
    try {
      await Mikrotik.collection.dropIndex("clientDevice_1");
      console.log("✅ Старый индекс clientDevice_1 удалён");
    } catch (error) {
      console.log(
        `ℹ️  Индекс clientDevice_1 не удалён (вероятно, отсутствует): ${error.message}`,
      );
    }

    // 3. Синхронизируем индексы со схемой: построит партиал-уникальный
    //    clientDevice_1, уберёт устаревшие.
    const dropped = await Mikrotik.syncIndexes();
    console.log(`✅ Индексы синхронизированы. Удалено устаревших: ${dropped.length}`);

    const indexes = await Mikrotik.collection.indexes();
    console.log("Текущие индексы Mikrotik:");
    indexes.forEach((i) =>
      console.log(
        `   ${i.name}: ${JSON.stringify(i.key)}` +
          `${i.unique ? " (unique)" : ""}` +
          `${i.partialFilterExpression ? " (partial)" : ""}`,
      ),
    );
  } catch (error) {
    console.error("❌ Ошибка миграции индексов Mikrotik:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Run the script if called directly
if (require.main === module) {
  migrate();
}

module.exports = { migrate };
