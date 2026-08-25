// Снимок ЭФФЕКТИВНЫХ прав всех пользователей — приёмка миграции ролей.
//
// Автотестов в проекте нет, поэтому единственная убедительная проверка такая:
// снять снимок до раздачи ролей, снять после и сравнить `diff`. Он обязан быть
// ПУСТ. Права считаются той же функцией, что и в бою (`effectivePermissions`),
// а не пересчитываются скриптом заново — иначе сверялись бы две реализации, а
// не состояние до и после.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/dumpEffectivePermissions.js > /tmp/before.txt
//   …раздача ролей…
//   node scripts/dumpEffectivePermissions.js > /tmp/after.txt
//   diff /tmp/before.txt /tmp/after.txt && echo "права не изменились"
require("module-alias/register");
const mongoose = require("mongoose");

const { statementsToActions } = require("@/auth/access");

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const { initAuth } = require("@/auth/bootstrap");
  await initAuth();
  const { effectivePermissions } = require("@/services/permissions");
  const User = require("@/models/user");

  // Сортировка по _id, а не по имени: имя могут поменять между снимками, и
  // тогда diff покажет перестановку строк вместо реальной разницы прав.
  const users = await User.find({}).sort({ _id: 1 }).lean();

  for (const user of users) {
    const { statements } = await effectivePermissions(user);
    const granted = statementsToActions(statements);
    console.log(
      [
        String(user._id),
        user.email || "",
        user.isAdmin ? "admin" : "",
        granted.join(",") || "-",
      ].join("\t"),
    );
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
