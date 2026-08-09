// Конец переходного состояния: роли становятся ЕДИНСТВЕННЫМ источником прав.
//
// После раздачи ролей права считались объединением «роли + личные галочки», и
// это опасно тем, что незаметно: у 29 человек роли дают ровно то же, что их
// галочки, поэтому снятие роли не изменило бы ничего — форма показывала бы
// одно, а система делала другое. Скрипт снимает личные права у всех.
//
// Он же доводит роль полного доступа до всего словаря. `isAdmin` теперь
// зеркалит именно её (auth/access.js#isFullAccess), и роль, которой не хватает
// одного действия, гасила бы зеркало при первом же сохранении формы.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/dumpEffectivePermissions.js > /tmp/before.txt
//   node scripts/stripOwnPermissions.js            # только показать
//   node scripts/stripOwnPermissions.js --apply
//   node scripts/dumpEffectivePermissions.js > /tmp/after.txt
//   diff /tmp/before.txt /tmp/after.txt
//
// В диффе ОБЯЗАНЫ остаться только те, у кого личные права были шире ролей.
require("module-alias/register");
const mongoose = require("mongoose");

const { PERMISSION_KEYS } = require("@/utils/permissions");

const APPLY = process.argv.includes("--apply");
/** Роль, которую доводим до полного словаря. */
const ADMIN_KEY = "admin";

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const { initAuth } = require("@/auth/bootstrap");
  await initAuth();

  const { STATEMENT, isFullAccess } = require("@/auth/access");
  const { organizationId, invalidateRoles } = require("@/services/permissions");
  const User = require("@/models/user");

  const db = mongoose.connection.db;
  const orgId = await organizationId();
  if (!orgId) {
    throw new Error("Организация не создана — сначала migrateOrganization.js");
  }

  // ── 1. Роль полного доступа ───────────────────────────────────────────
  const admin = await db
    .collection("organizationRole")
    .findOne({ organizationId: orgId, role: ADMIN_KEY });

  if (!admin) {
    console.log(`Роль «${ADMIN_KEY}» не найдена — шаг пропущен`);
  } else {
    const statements = JSON.parse(admin.permission || "{}");
    // Проверка, что это действительно административная роль, а не однофамилец:
    // дописать весь словарь случайной роли значило бы раздать портал.
    const looksAdministrative =
      statements?.user?.includes("manage") && statements?.role?.includes("manage");

    if (!looksAdministrative) {
      console.log(
        `Роль «${ADMIN_KEY}» не управляет ни людьми, ни ролями — не трогаю`,
      );
    } else if (isFullAccess(statements)) {
      console.log(`Роль «${ADMIN_KEY}» уже даёт весь словарь`);
    } else {
      const missing = Object.entries(STATEMENT).flatMap(([resource, actions]) =>
        actions
          .filter((action) => !statements?.[resource]?.includes(action))
          .map((action) => `${resource}.${action}`),
      );
      console.log(`Роль «${ADMIN_KEY}» дополняется: ${missing.join(", ")}`);
      if (APPLY) {
        await db
          .collection("organizationRole")
          .updateOne(
            { _id: admin._id },
            { $set: { permission: JSON.stringify(STATEMENT), updatedAt: new Date() } },
          );
        invalidateRoles();
      }
    }
  }

  // ── 2. Личные права ───────────────────────────────────────────────────
  const users = await User.find({}).select("email permissions").lean();
  const withOwn = users.filter((user) =>
    PERMISSION_KEYS.some((key) => user.permissions?.[key] === true),
  );

  console.log(`\nЛичные права есть у ${withOwn.length} чел. из ${users.length}`);
  for (const user of withOwn) {
    const own = PERMISSION_KEYS.filter((key) => user.permissions?.[key]);
    console.log(`  ${user.email}: ${own.join(", ")}`);
  }

  if (!APPLY) {
    console.log("\nБез --apply ничего не записано");
    await mongoose.disconnect();
    return;
  }

  // Ключи выставляются в false, а не $unset: схема объявляет их полями с
  // `default: false`, и документ без них разъехался бы с моделью.
  const reset = Object.fromEntries(
    PERMISSION_KEYS.map((key) => [`permissions.${key}`, false]),
  );
  const result = await User.collection.updateMany({}, { $set: reset });
  console.log(`\nЛичные права сняты: изменено документов ${result.modifiedCount}`);

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
