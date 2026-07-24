// Одноразовое перешифрование ключей PRO32 Connect (user.getScreen.api):
// плейнтекст-ключи, сохранённые до ввода шифрования (2026-07-24), становятся
// AES-256-GCM-шифртекстом secretBox. Идемпотентен (isEncrypted-гард) —
// повторный запуск ничего не меняет. Запуск внутри контейнера бэкенда:
//   node scripts/encryptGetScreenKeys.js
require("module-alias/register");
const mongoose = require("mongoose");

const User = require("../models/user");
const { encryptSecret, isEncrypted } = require("../services/crypto/secretBox");

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const users = await User.find({ "getScreen.api": { $nin: [null, ""] } });
  let migrated = 0;

  for (const user of users) {
    if (isEncrypted(user.getScreen.api)) continue;
    user.getScreen = { api: encryptSecret(user.getScreen.api) };
    await user.save();
    migrated += 1;
    console.log(`перешифрован: ${user.lastName} ${user.firstName}`);
  }

  console.log(`Готово: ключей всего ${users.length}, перешифровано ${migrated}`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("Не удалось перешифровать ключи:", error);
  process.exit(1);
});
