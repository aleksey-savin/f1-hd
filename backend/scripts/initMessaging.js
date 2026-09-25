// «Диалоги», 2026-09-25: категория уведомлений включена у существующих установок.
// Mongoose подставляет default только при чтении документа моделью, а
// колокольчик читает настройки через lean() — без записи поля категория
// оставалась бы выключенной. Модуль при этом не трогаем: он включается руками.
//
// Идемпотентен:
//   node scripts/initMessaging.js           # показать
//   node scripts/initMessaging.js --apply   # записать
require("module-alias/register");
const mongoose = require("mongoose");

const run = async () => {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const preferences = mongoose.connection.db.collection("preferences");
  const filter = { "notify.personal.conversationMessage": { $exists: false } };
  const count = await preferences.countDocuments(filter);
  console.log(`Настроек без категории «Диалоги»: ${count}`);
  if (apply && count) {
    await preferences.updateMany(filter, { $set: { "notify.personal.conversationMessage": true } });
    console.log("Категория включена.");
  }
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
