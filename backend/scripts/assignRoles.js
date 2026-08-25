// Заводит роли из каталога и раздаёт их людям. Главный шаг этапа ролей.
//
// СОПОСТАВЛЕНИЕ ПО ПОДПИСИ ПРАВ, а не по имени и не по id. Это единственное,
// что делает перенос на прод безопасным: там свои учётки, свои id и данные,
// ушедшие вперёд от копии. Скрипт смотрит, какой набор прав у человека
// фактически, и находит роль, которая этот набор поглощает.
//
// ОСТАНАВЛИВАЕТСЯ, если чья-то подпись не описана ни одной ролью. Это не
// придирка: незнакомый набор означает, что на проде появился человек с
// правами, которых на копии не было, и молча приписать ему чужую роль —
// худшее, что можно сделать. Такой человек показывается поимённо, и решение
// принимает человек: дополнить каталог или поправить права.
//
// Идемпотентен. `--rollback` чистит `member.role` — но ПРАВА ПРИ ЭТОМ НЕ
// ВОЗВРАЩАЮТСЯ: личные галочки в документах остаются нетронутыми, однако
// приложение их больше не читает (`services/permissions.js`). Откат этого
// релиза — предыдущий образ; тот код снова прочитает те же документы, потому
// что скрипт не трогает `user.permissions` НИКОГДА.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/assignRoles.js             # показать план и изменения прав
//   node scripts/assignRoles.js --apply     # записать
//   node scripts/assignRoles.js --rollback  # снять все роли
require("module-alias/register");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { PERMISSION_KEYS, legacyToActions } = require("./legacyPermissions");
const { syncCatalogue } = require("./syncRoleCatalogue");
const { actionsToStatements } = require("@/auth/access");
const { ORG_SLUG } = require("@/services/permissions");

const CATALOGUE = path.join(__dirname, "roles.catalogue.json");

/** Подпись набора — права в порядке PERMISSION_KEYS, через запятую. */
const signature = (keys) =>
  PERMISSION_KEYS.filter((key) => keys.includes(key)).join(",");

const run = async () => {
  const apply = process.argv.includes("--apply");
  const rollback = process.argv.includes("--rollback");

  const { roles } = JSON.parse(fs.readFileSync(CATALOGUE, "utf8"));

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;

  const org = await db.collection("organization").findOne({ slug: ORG_SLUG });
  if (!org) {
    throw new Error(
      "Организации нет — сначала scripts/migrateOrganization.js --apply",
    );
  }
  const orgId = String(org._id);

  /**
   * Скрипт выводит роли из ДОРОЛЕВЫХ галочек в документах. Если их нет ни у
   * кого, подпись у всех пустая, и повторный запуск раздал бы ВСЕМ роль с
   * пустым набором прав — то есть стёр бы раздачу целиком.
   *
   * Проверено на своей шкуре: 696 членств стали «Клиент» одной командой.
   */
  if (!rollback) {
    const withOwn = await db.collection("users").countDocuments({
      $or: PERMISSION_KEYS.map((key) => ({ [`permissions.${key}`]: true })),
    });
    if (!withOwn) {
      throw new Error(
        "Доролевых прав нет ни у кого — выводить роли не из чего. " +
          "Похоже, раздача уже выполнена: роли живут в member.role, " +
          "и повторный запуск их сотрёт.",
      );
    }
  }

  if (rollback) {
    const result = await db
      .collection("member")
      .updateMany({ organizationId: orgId }, { $set: { role: "" } });
    console.log(`Роли сняты у ${result.modifiedCount} членов.`);
    console.log(
      "ВНИМАНИЕ: права при этом не вернулись — доролевые галочки в документах " +
        "целы, но этот код их не читает. Полный откат — предыдущий образ.",
    );
    await mongoose.disconnect();
    return;
  }

  // Подпись → роль. Пересечения между ролями — ошибка каталога.
  const bySignature = new Map();
  for (const role of roles) {
    for (const match of role.matches) {
      const key = signature(match);
      if (bySignature.has(key)) {
        throw new Error(
          `Подпись «${key || "(нет прав)"}» описана дважды: ` +
            `«${bySignature.get(key).title}» и «${role.title}»`,
        );
      }
      bySignature.set(key, role);
    }
  }

  const users = await db
    .collection("users")
    .find(
      { isServiceAccount: { $ne: true } },
      {
        projection: {
          permissions: 1,
          isAdmin: 1,
          firstName: 1,
          lastName: 1,
          email: 1,
        },
      },
    )
    .toArray();

  const plan = [];
  const unknown = [];

  for (const user of users) {
    const own = PERMISSION_KEYS.filter((key) => user.permissions?.[key]);
    const role = bySignature.get(signature(own));

    if (!role) {
      unknown.push({ user, own });
      continue;
    }

    // Сравниваем в НОВОМ языке: подпись человека — доролевая, набор роли —
    // словарь. Прежние галочки переводятся расширением (`legacyToActions`),
    // поэтому «получит» показывает настоящую разницу, а не разницу словарей.
    const ownActions = legacyToActions(user.permissions || {});
    const roleActions = role.actions || [];
    const gained = roleActions.filter((id) => !ownActions.includes(id));
    const lost = ownActions.filter((id) => !roleActions.includes(id));
    plan.push({ user, role, gained, lost });
  }

  if (unknown.length) {
    console.error(
      `\nОСТАНОВЛЕНО: ${unknown.length} чел. с набором прав, которого нет в каталоге.\n`,
    );
    for (const { user, own } of unknown) {
      console.error(
        `  ${`${user.lastName || ""} ${user.firstName || ""}`.trim() || user.email}` +
          `\n    ${own.join(", ") || "(нет прав)"}`,
      );
    }
    console.error(
      "\nДополните scripts/roles.catalogue.json (поле matches) или поправьте права людям.",
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  // --- отчёт ---------------------------------------------------------------

  const counts = new Map();
  for (const item of plan) {
    counts.set(item.role.key, (counts.get(item.role.key) || 0) + 1);
  }

  console.log("Раздача ролей:\n");
  for (const role of roles) {
    console.log(`  ${role.title} — ${counts.get(role.key) || 0} чел.`);
  }

  const changed = plan.filter((item) => item.gained.length || item.lost.length);
  console.log(
    `\nРоль отличается от собственного набора у ${changed.length} чел. из ${plan.length}:`,
  );
  for (const item of changed) {
    const name =
      `${item.user.lastName || ""} ${item.user.firstName || ""}`.trim() ||
      item.user.email;
    console.log(`\n  ${name} → «${item.role.title}»`);
    if (item.gained.length) console.log(`    + ${item.gained.join(", ")}`);
    // «−» НЕ означает потерю доступа. Пока `user.permissions` жив, эффективные
    // права — объединение роли и собственных флагов, и такое право у человека
    // остаётся. Строка показывает, чего не будет в тот день, когда собственные
    // флаги снимут: это список к осознанной проверке, а не факт отзыва.
    if (item.lost.length) {
      console.log(`    − ${item.lost.join(", ")}  (в роль не входит)`);
    }
  }
  if (!changed.length) console.log("  ни у кого — раздача чисто структурная");
  console.log(
    "\n«+» вступает в силу сразу. «−» — только когда снимут user.permissions:\n" +
      "сейчас эффективные права это объединение роли и собственных флагов.",
  );

  if (!apply) {
    console.log("\nПоказ без записи. Повторите с --apply.");
    await mongoose.disconnect();
    return;
  }

  // --- запись --------------------------------------------------------------

  // Тот же код, что и у `syncRoleCatalogue.js`: каталог обязан выглядеть
  // одинаково, кем бы его ни записали. Второй копии этих полей быть не должно
  // — разъехавшийся `audience` или потерянное описание нашлись бы нескоро.
  await syncCatalogue(db, orgId, roles, { actionsToStatements });
  console.log(`\nРолей в каталоге: ${roles.length}`);

  let assigned = 0;
  for (const item of plan) {
    const result = await db
      .collection("member")
      .updateOne(
        { organizationId: orgId, userId: String(item.user._id) },
        { $set: { role: item.role.key } },
      );
    assigned += result.modifiedCount;
  }
  console.log(`Роль проставлена: ${assigned} чел.`);

  const withoutRole = await db
    .collection("member")
    .countDocuments({ organizationId: orgId, role: "" });
  console.log(`Осталось без роли: ${withoutRole} (ожидается 0)`);

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
