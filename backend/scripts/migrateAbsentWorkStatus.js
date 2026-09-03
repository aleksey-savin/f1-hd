// Слияние статуса присутствия «отсутствует» (absent) в «не на работе»
// (offshift). Оба значили «человека нет», а почему и до когда, говорит
// заметка; после удаления кода из каталога документ с `absent` не проходит
// валидацию схемы (enum) — любой `user.save()` у такого человека падал бы.
//
// Идемпотентен: без документов с `absent` ничего не делает.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/migrateAbsentWorkStatus.js            # показать
//   node scripts/migrateAbsentWorkStatus.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

async function main() {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const users = mongoose.connection.db.collection("users");

  const affected = await users.countDocuments({ "workStatus.code": "absent" });
  console.log(`Со статусом absent: ${affected} → offshift (заметка сохраняется)`);

  if (!apply) {
    console.log("\nПоказ без записи. Повторите с --apply.");
    await mongoose.disconnect();
    return;
  }

  const result = await users.updateMany(
    { "workStatus.code": "absent" },
    { $set: { "workStatus.code": "offshift" } },
  );
  console.log(`Обновлено: ${result.modifiedCount}`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
