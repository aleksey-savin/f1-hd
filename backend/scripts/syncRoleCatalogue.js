// Синхронизация КАТАЛОГА ролей с `roles.catalogue.json`: названия, описания,
// адресаты и наборы прав. Членство не трогается вовсе.
//
// Отдельно от `assignRoles.js` не для красоты. Тот выводит роли из личных
// галочек и после `stripOwnPermissions.js` запускаться не имеет права — иначе
// раздаст всем роль с пустым набором. А каталог править надо и потом: новое
// право в словаре обязано попасть в роль полного доступа, иначе `isFullAccess`
// перестанет её узнавать и зеркало `isAdmin` погаснет у всех администраторов.
//
// Идемпотентен. Запуск внутри контейнера бэкенда:
//   node scripts/syncRoleCatalogue.js            # только показать
//   node scripts/syncRoleCatalogue.js --apply
require("module-alias/register");
const fs = require("fs");
const path = require("path");

const CATALOGUE = path.join(__dirname, "roles.catalogue.json");

/**
 * Записывает роли каталога в `organizationRole`. Ключ роли неизменяем и служит
 * идентификатором — членство хранит роль именно им.
 */
const syncCatalogue = async (db, orgId, roles, { permissionsToStatements }) => {
  const written = [];
  for (const role of roles) {
    const permission = JSON.stringify(
      permissionsToStatements(
        Object.fromEntries(role.permissions.map((key) => [key, true])),
      ),
    );
    const result = await db.collection("organizationRole").updateOne(
      { organizationId: orgId, role: role.key },
      {
        $set: {
          permission,
          // Название и описание — отдельные поля: ключ роли неизменяем, потому
          // что членство хранит роль именно им.
          title: role.title,
          description: role.description || "",
          // Кому роль предлагать в форме человека. Вывести из прав нельзя:
          // «Клиент: руководитель» даёт учёт времени и отчёты по работам —
          // права не клиентские, а роль клиентская.
          audience: role.audience === "client" ? "client" : "staff",
          updatedAt: new Date(),
        },
        $setOnInsert: {
          organizationId: orgId,
          role: role.key,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    written.push({
      key: role.key,
      created: Boolean(result.upsertedCount),
      changed: Boolean(result.modifiedCount),
    });
  }
  return written;
};

const run = async () => {
  const apply = process.argv.includes("--apply");
  const mongoose = require("mongoose");
  const { roles } = JSON.parse(fs.readFileSync(CATALOGUE, "utf8"));

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;

  const { initAuth } = require("@/auth/bootstrap");
  await initAuth();
  const access = require("@/auth/access");
  const { organizationId, invalidateRoles } = require("@/services/permissions");

  const orgId = await organizationId();
  if (!orgId) {
    throw new Error("Организации нет — сначала scripts/migrateOrganization.js");
  }

  // Роль полного доступа обязана содержать ВЕСЬ словарь: по этому признаку
  // зеркалится `isAdmin`, и роль без одного действия погасила бы его.
  const full = roles.filter((role) =>
    access.isFullAccess(
      access.permissionsToStatements(
        Object.fromEntries(role.permissions.map((key) => [key, true])),
      ),
    ),
  );
  if (!full.length) {
    throw new Error(
      "В каталоге нет ни одной роли, дающей весь словарь. " +
        "Без неё некому быть администратором — добавьте новое право в роль «admin».",
    );
  }
  console.log(`Полный доступ дают: ${full.map((r) => r.key).join(", ")}`);

  if (!apply) {
    console.log(`Ролей в каталоге: ${roles.length}. Без --apply не записано.`);
    await mongoose.disconnect();
    return;
  }

  const written = await syncCatalogue(db, String(orgId), roles, access);
  invalidateRoles();

  const created = written.filter((row) => row.created).map((row) => row.key);
  const changed = written.filter((row) => row.changed).map((row) => row.key);
  console.log(`Заведено: ${created.length ? created.join(", ") : "—"}`);
  console.log(`Обновлено: ${changed.length ? changed.join(", ") : "—"}`);

  await mongoose.disconnect();
};

module.exports = { syncCatalogue, CATALOGUE };

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
