// Приведение поля `users.role` в соответствие с ролями приложения.
//
// `role` — поле системы прав ПЛАГИНА `admin`, а не наше. По нему плагин решает,
// пускать ли к своим ручкам; из всех его действий нам нужно ровно одно —
// подмена, поэтому значение бывает только `impersonator` или `user`. Штатная
// роль плагина `admin` не выдаётся никому: она открыла бы заодно смену чужих
// паролей и заведение пользователей мимо наших правил.
//
// Прежнее содержимое поля — мусор из старой системы: «Клиент» у 376 человек,
// пусто у 325, осмысленное значение одно. Оно затирается.
//
// Скрипт идемпотентен и нужен там, где роли назначались не через
// `services/roles.js#assign` (миграция, скрипты, руки в mongosh).
//
//   node scripts/syncPluginRole.js            # только показать
//   node scripts/syncPluginRole.js --apply
require("module-alias/register");
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const { initAuth } = require("@/auth/bootstrap");
  await initAuth();
  const { effectivePermissions } = require("@/services/permissions");
  const { pluginRole } = require("@/services/roles");
  const { permissionsToStatements } = require("@/auth/access");
  const User = require("@/models/user");

  const users = await User.find({}).select("_id email role").lean();

  const changes = [];
  for (const user of users) {
    const { permissions } = await effectivePermissions(user);
    const wanted = pluginRole(permissionsToStatements(permissions));
    if (user.role === wanted) continue;
    changes.push({ user, wanted });
  }

  const granted = changes.filter((row) => row.wanted === "impersonator");
  console.log(`Всего пользователей: ${users.length}`);
  console.log(`Изменится: ${changes.length}`);
  console.log(`Из них получат право на подмену: ${granted.length}`);
  for (const row of granted) {
    console.log(`  ${row.user.email}`);
  }

  if (!APPLY) {
    console.log("\nБез --apply ничего не записано");
    await mongoose.disconnect();
    return;
  }

  for (const row of changes) {
    await User.collection.updateOne(
      { _id: row.user._id },
      { $set: { role: row.wanted } },
    );
  }
  console.log(`\nЗаписано: ${changes.length}`);

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
