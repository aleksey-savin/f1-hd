// Переезд паролей на better-auth (2026-08). Для каждого пользователя с
// установленным password заводит запись в authAccounts с providerId
// "credential" и ТЕМ ЖЕ bcrypt-хешем: ни писем, ни сбросов — люди входят
// прежними паролями.
//
// Запись создаётся ЧЕРЕЗ internalAdapter better-auth, а не рукописным
// документом: форма записи (тип userId, генерация _id, имена полей) — его
// внутреннее дело, и ошибка на один тип дала бы «неверная почта или пароль»
// сразу всем, причём выяснилось бы это только в проде.
//
// Унаследованные хеши остаются bcrypt: проверка их распознаёт по префиксу
// `$2` (auth/instance.mjs). Штатным scrypt пароль станет при первой смене.
//
// Идемпотентен: пропускает тех, у кого credential-аккаунт уже есть.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/migrateAuthAccounts.js            # только показать
//   node scripts/migrateAuthAccounts.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const { initAuth, getAuth } = require("@/auth/bootstrap");

const BCRYPT = /^\$2[aby]\$\d{2}\$/;

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  await initAuth();
  const ctx = await getAuth().$context;

  const db = mongoose.connection.db;
  const users = db.collection("users");
  const accounts = db.collection("authAccounts");

  const candidates = await users
    .find({ password: { $exists: true, $ne: "" } })
    .project({ _id: 1, email: 1, password: 1 })
    .toArray();

  let created = 0;
  let skipped = 0;
  const broken = [];

  for (const user of candidates) {
    const userId = user._id.toString();

    // Ищем обоими способами: в зависимости от версии адаптера userId может
    // лежать строкой или ObjectId, и односторонняя проверка молча наплодила бы
    // вторые аккаунты при повторном прогоне.
    const existing = await accounts.findOne({
      providerId: "credential",
      $or: [{ userId }, { userId: user._id }, { accountId: userId }],
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    if (!BCRYPT.test(user.password)) {
      broken.push(`${user.email} (${user.password.slice(0, 7)}…)`);
      continue;
    }

    if (apply) {
      await ctx.internalAdapter.createAccount({
        userId,
        accountId: userId,
        providerId: "credential",
        password: user.password,
      });
    }
    created += 1;
  }

  console.log(`Пользователей с паролем: ${candidates.length}`);
  console.log(`${apply ? "Создано" : "Будет создано"}: ${created}`);
  console.log(`Уже было: ${skipped}`);
  if (broken.length) {
    console.log(`ПРОПУЩЕНО (хеш не bcrypt): ${broken.length}`);
    broken.slice(0, 10).forEach((item) => console.log(`  ${item}`));
  }

  if (apply) {
    const total = await accounts.countDocuments({ providerId: "credential" });
    console.log(`\nВсего credential-аккаунтов: ${total}`);
    const sample = await accounts.findOne({ providerId: "credential" });
    console.log(
      "Форма записи (проверьте ТИП userId глазами):",
      JSON.stringify(
        {
          _id: `${sample._id} (${sample._id.constructor.name})`,
          userId: `${sample.userId} (${typeof sample.userId})`,
          accountId: sample.accountId,
          providerId: sample.providerId,
          password: `${String(sample.password).slice(0, 7)}…`,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("\nПробный прогон. Для записи: node scripts/migrateAuthAccounts.js --apply");
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("Не удалось перенести пароли:", error);
  process.exit(1);
});
