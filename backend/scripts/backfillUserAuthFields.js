// Проставление emailVerified существующим пользователям (переезд на
// better-auth, 2026-08). Эти учётки заводил администратор, и требовать от них
// подтверждения адреса задним числом значило бы запереть снаружи всю базу.
//
// Идемпотентен: ставит true только там, где поля НЕТ ВОВСЕ. Учётка с явным
// `emailVerified: false` — это уже новый, не подтвердивший почту человек, и
// трогать его нельзя, иначе повторный прогон скрипта подтвердит адрес за него.
//
// Работает нативным драйвером: save() на легаси-документах упал бы на валидации
// полей, к этой миграции отношения не имеющих.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/backfillUserAuthFields.js            # только показать
//   node scripts/backfillUserAuthFields.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const users = mongoose.connection.db.collection("users");

  const total = await users.countDocuments();
  const missing = await users.countDocuments({ emailVerified: { $exists: false } });
  const explicitlyUnverified = await users
    .find({ emailVerified: false })
    .project({ email: 1 })
    .toArray();

  console.log(`Пользователей всего: ${total}`);
  console.log(`Без emailVerified (будут подтверждены): ${missing}`);

  if (explicitlyUnverified.length) {
    console.log(
      `Пропускаем ${explicitlyUnverified.length} с явным emailVerified: false — ` +
        "они заведены уже после переезда, их подтверждение не наше дело:",
    );
    explicitlyUnverified.slice(0, 10).forEach((user) => console.log(`  ${user.email}`));
  }

  if (!apply) {
    console.log("\nПробный прогон. Для записи: node scripts/backfillUserAuthFields.js --apply");
    await mongoose.disconnect();
    return;
  }

  const result = missing
    ? await users.updateMany(
        { emailVerified: { $exists: false } },
        { $set: { emailVerified: true } },
      )
    : { modifiedCount: 0 };

  console.log(`\nГотово. Подтверждено: ${result.modifiedCount}`);
  console.log(`Осталось без поля: ${await users.countDocuments({ emailVerified: { $exists: false } })}`);
  console.log(`Пользователей всего: ${await users.countDocuments()} (было ${total})`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("Не удалось проставить emailVerified:", error);
  process.exit(1);
});
