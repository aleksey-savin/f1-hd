// Переезд `users.isActive` → `users.banned` (better-auth, плагин `admin`).
//
// Полярность обратная: `isActive: false` значит «отключён», и это же состояние
// теперь `banned: true`. Отсутствие поля значит «работает» — поэтому фильтры в
// коде пишутся как `{ banned: { $ne: true } }`, а не `{ banned: false }`.
//
// Почему вообще меняем поле, а не оставляем своё: плагин сам проверяет флаг при
// создании сеанса, сам снимает просроченный бан по `banExpires` и сам отзывает
// сеансы. У `isActive` из этого не было ничего — отключённый пользователь жил
// до истечения собственного токена.
//
// Идемпотентен: документы, где `isActive` уже нет, не трогает. Работает
// нативным драйвером, а не через save(): на легаси-данных полная валидация
// упала бы на полях, к отключению отношения не имеющих.
//
// Резервная копия — копией коллекции внутрь той же базы: mongodump в контейнере
// бэкенда нет, а восстановление из копии это один aggregate обратно:
//   db.users_before_banned.aggregate([{ $out: "users" }])
//
// Запуск внутри контейнера бэкенда:
//   node scripts/migrateUserBanned.js            # только показать
//   node scripts/migrateUserBanned.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const BACKUP_COLLECTION = "users_before_banned";

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;
  const users = db.collection("users");

  const total = await users.countDocuments({});
  const withField = await users.countDocuments({ isActive: { $exists: true } });
  const disabled = await users.countDocuments({ isActive: false });
  const missing = await users.countDocuments({
    isActive: { $exists: false },
    banned: { $exists: false },
  });

  console.log(`Всего пользователей:        ${total}`);
  console.log(`С полем isActive:           ${withField}`);
  console.log(`  из них отключённых:       ${disabled}  → banned: true`);
  console.log(`  из них активных:          ${withField - disabled}  → banned: false`);
  console.log(`Без обоих полей:            ${missing}  → banned: false`);

  if (!apply) {
    console.log("\nПоказ без записи. Повторите с --apply.");
    await mongoose.disconnect();
    return;
  }

  // Копия ДО первой записи. Ронять миграцию, если копия не сделалась, —
  // единственно верное поведение: без неё откат невозможен.
  const existing = await db
    .listCollections({ name: BACKUP_COLLECTION })
    .toArray();
  if (existing.length) {
    console.log(`\nКопия ${BACKUP_COLLECTION} уже есть — оставляю как есть.`);
  } else {
    await users.aggregate([{ $out: BACKUP_COLLECTION }]).toArray();
    const copied = await db.collection(BACKUP_COLLECTION).countDocuments({});
    if (copied !== total) {
      throw new Error(
        `Копия неполная: ${copied} из ${total}. Миграция остановлена.`,
      );
    }
    console.log(`\nКопия сделана: ${BACKUP_COLLECTION} (${copied} документов)`);
  }

  const toBanned = await users.updateMany(
    { isActive: false },
    { $set: { banned: true }, $unset: { isActive: "" } },
  );
  // Порядок значим: отключённые уже разобраны и поле у них снято, поэтому
  // «всё, у кого isActive ещё есть» — это ровно активные.
  const toActive = await users.updateMany(
    { isActive: { $exists: true } },
    { $set: { banned: false }, $unset: { isActive: "" } },
  );
  // Документы, где поля не было вовсе (заведённые better-auth мимо схемы).
  const filled = await users.updateMany(
    { banned: { $exists: false } },
    { $set: { banned: false } },
  );

  console.log(`Отключено (banned: true):   ${toBanned.modifiedCount}`);
  console.log(`Активно  (banned: false):   ${toActive.modifiedCount}`);
  console.log(`Дозаполнено без isActive:   ${filled.modifiedCount}`);

  const leftovers = await users.countDocuments({ isActive: { $exists: true } });
  const withoutBanned = await users.countDocuments({
    banned: { $exists: false },
  });
  console.log(`\nОсталось с isActive:        ${leftovers} (ожидается 0)`);
  console.log(`Осталось без banned:        ${withoutBanned} (ожидается 0)`);

  if (leftovers || withoutBanned) {
    throw new Error("Миграция не завершилась полностью — разберитесь вручную.");
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
