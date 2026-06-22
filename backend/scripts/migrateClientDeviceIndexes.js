const mongoose = require("mongoose");
const ClientDevice = require("../models/inventory/clientDevice");

// Разовая идемпотентная миграция индексов ClientDevice.
//
// Серийный номер стал опциональным (у самосборной техники его нет), а первичным
// идентификатором стал инвентарный номер. Обычный уникальный индекс по серийнику
// не годится: он считает отсутствующее значение как null и разрешает лишь один
// документ без серийника. Нужны ПАРТИАЛ-уникальные индексы (уникальность только
// для реально заданных строк) по serialNumber и inventoryNumber.
//
// Mongoose НЕ меняет опции уже существующего индекса автоматически — старый
// serialNumber_1 нужно явно удалить, после чего syncIndexes() построит
// партиал-индексы из схемы.
async function migrate() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    // 1. Пред-проверка: дубли непустых значений сломают построение уникального
    //    индекса. Находим их и при наличии — прерываем (данные чинить вручную).
    for (const field of ["serialNumber", "inventoryNumber"]) {
      const dupes = await ClientDevice.aggregate([
        { $match: { [field]: { $type: "string", $ne: "" } } },
        {
          $group: {
            _id: `$${field}`,
            count: { $sum: 1 },
            ids: { $push: "$_id" },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ]);
      if (dupes.length > 0) {
        console.error(
          `❌ Найдены дубли по ${field} — миграция прервана. Устраните их и повторите:`,
        );
        dupes.forEach((d) =>
          console.error(
            `   ${field}="${d._id}": ${d.count} шт. (${d.ids.join(", ")})`,
          ),
        );
        return;
      }
    }
    console.log("✅ Дубли serialNumber/inventoryNumber не найдены");

    // 2. Удаляем старый обычный уникальный индекс по серийнику (best-effort —
    //    может отсутствовать или иметь нестандартное имя).
    try {
      await ClientDevice.collection.dropIndex("serialNumber_1");
      console.log("✅ Старый индекс serialNumber_1 удалён");
    } catch (error) {
      console.log(
        `ℹ️  Индекс serialNumber_1 не удалён (вероятно, отсутствует): ${error.message}`,
      );
    }

    // 3. Синхронизируем индексы со схемой: построит партиал-уникальные индексы по
    //    serialNumber и inventoryNumber, уберёт устаревшие.
    const dropped = await ClientDevice.syncIndexes();
    console.log(
      `✅ Индексы синхронизированы. Удалено устаревших: ${dropped.length}`,
    );

    const indexes = await ClientDevice.collection.indexes();
    console.log("Текущие индексы ClientDevice:");
    indexes.forEach((i) =>
      console.log(
        `   ${i.name}: ${JSON.stringify(i.key)}` +
          `${i.unique ? " (unique)" : ""}` +
          `${i.partialFilterExpression ? " (partial)" : ""}`,
      ),
    );
  } catch (error) {
    console.error("❌ Ошибка миграции индексов ClientDevice:", error);
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
