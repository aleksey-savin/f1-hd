// Приведение users.email к каноничной форме (переезд на better-auth, 2026-08):
// обрезка пробелов и нижний регистр. Схема с этого момента делает то же самое
// сеттерами, но существующие документы через save() не проходят — их правит
// этот скрипт.
//
// Идемпотентен: трогает только документы, у которых адрес отличается от
// каноничного. Работает нативным драйвером, а не через save(): на легаси-данных
// полная валидация документа упала бы на полях, к почте отношения не имеющих.
//
// ОТКАЗЫВАЕТСЯ РАБОТАТЬ при коллизиях: если «Ivanov@…» и «ivanov@…» существуют
// оба, слияние — решение человека, а не скрипта. Разбор — scripts/checkEmailCollisions.js.
//
// Резервная копия делается копией коллекции внутрь той же базы: mongodump в
// контейнере бэкенда нет (он есть в контейнере mongo), а восстановление из
// копии — это один aggregate обратно.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/normalizeUserEmails.js            # только показать
//   node scripts/normalizeUserEmails.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const BACKUP_COLLECTION = "users_before_email_normalize";

const canonical = (email) => String(email || "").trim().toLowerCase();

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const users = db.collection("users");

  // 1. Коллизии — стоп-кран
  const collisions = await users
    .aggregate([
      {
        $group: {
          _id: { $toLower: { $trim: { input: "$email" } } },
          count: { $sum: 1 },
          emails: { $push: "$email" },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  if (collisions.length) {
    console.error(
      `Нормализация невозможна: ${collisions.length} адресов схлопнутся в один.`,
    );
    collisions.forEach((group) =>
      console.error(`  ${group._id} ← ${JSON.stringify(group.emails)}`),
    );
    console.error("Разберите их вручную: node scripts/checkEmailCollisions.js");
    await mongoose.disconnect();
    process.exit(1);
  }

  // 2. Кого править
  const dirty = await users
    .find({ $expr: { $ne: ["$email", { $toLower: { $trim: { input: "$email" } } }] } })
    .project({ email: 1 })
    .toArray();

  console.log(`Всего пользователей: ${await users.countDocuments()}`);
  console.log(`Требуют нормализации: ${dirty.length}`);
  dirty.forEach((user) =>
    console.log(`  ${JSON.stringify(user.email)} → ${JSON.stringify(canonical(user.email))}`),
  );

  if (!dirty.length) {
    console.log("Нечего делать.");
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log("\nПробный прогон. Для записи: node scripts/normalizeUserEmails.js --apply");
    await mongoose.disconnect();
    return;
  }

  // 3. Копия ДО записи. Существующую не перезаписываем: она с прошлого прогона
  // и отражает состояние до первой правки — именно оно и нужно для отката.
  const existing = await db.listCollections({ name: BACKUP_COLLECTION }).toArray();
  if (existing.length) {
    console.log(`Копия ${BACKUP_COLLECTION} уже есть — оставляем её как есть.`);
  } else {
    await users.aggregate([{ $out: BACKUP_COLLECTION }]).toArray();
    console.log(
      `Копия сделана: ${BACKUP_COLLECTION} (${await db.collection(BACKUP_COLLECTION).countDocuments()} док.)`,
    );
  }

  // 4. Запись
  let modified = 0;
  for (const user of dirty) {
    const result = await users.updateOne(
      { _id: user._id },
      { $set: { email: canonical(user.email) } },
    );
    modified += result.modifiedCount;
  }

  const left = await users.countDocuments({
    $expr: { $ne: ["$email", { $toLower: { $trim: { input: "$email" } } }] },
  });

  console.log(`\nГотово. Изменено: ${modified}. Осталось ненормализованных: ${left}`);
  console.log(
    `Откат: db.${BACKUP_COLLECTION}.aggregate([{ $out: "users" }]) — вернёт коллекцию целиком.`,
  );
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("Не удалось нормализовать адреса:", error);
  process.exit(1);
});
