// Вернуть человеку роль полного доступа, когда выдать её из интерфейса некому.
//
// Выдать роль администратора может только тот, у кого есть все её права
// (`services/roles.js#assertNotEscalating`). Если последний администратор
// пересадил себя на роль поуже, роль остаётся в каталоге, а вернуть её уже
// некому — так вышло 2026-09-21: двое администраторов сняли с себя «Закрывать
// без записи о работе» вместе с ролью. От повторения теперь держит порог в
// `assign` (`losesLastFullAccessHolder`); этот скрипт — выход из уже
// случившегося.
//
// Назначение идёт ТОЙ ЖЕ функцией, что и из интерфейса (`roles.assign`):
// членство, зеркало `isAdmin` и роль плагина обновляются одним путём. Обходится
// ровно одна проверка — «нельзя выдать больше, чем есть у себя»: у скрипта
// «себя» нет, его запускает тот, у кого есть доступ к серверу.
//
// Запуск внутри контейнера бэкенда. Без --apply ничего не пишет:
//   node scripts/restoreFullAccess.js                      — кто держит полный доступ
//   node scripts/restoreFullAccess.js a@f1lab.ru b@f1lab.ru          — что изменится
//   node scripts/restoreFullAccess.js a@f1lab.ru b@f1lab.ru --apply  — выдать
require("module-alias/register");
const mongoose = require("mongoose");

const {
  ACTION_LABELS,
  STAFF_ACTIONS,
  isFullAccess,
  statementsToActions,
} = require("@/auth/access");

const run = async () => {
  const apply = process.argv.includes("--apply");
  const emails = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"))
    .map((email) => email.trim().toLowerCase());

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;

  const { initAuth } = require("@/auth/bootstrap");
  await initAuth();
  const { listRoles, organizationId } = require("@/services/permissions");
  const roles = require("@/services/roles");

  const catalogue = await listRoles();
  const fullRoles = catalogue.filter(
    (role) => role.audience === "staff" && isFullAccess(role.statements),
  );
  if (!fullRoles.length) {
    // Роль администратора отстала от словаря (в него добавили действие) — она
    // перестала считаться полным доступом, и выдавать тут нечего. Называем,
    // чего не хватает ближайшим ролям: догоняет их синхронизация каталога.
    console.log("В каталоге нет роли полного доступа. Ближайшие роли сотрудников:");
    const closest = catalogue
      .filter((role) => role.audience === "staff")
      .map((role) => {
        const has = new Set(statementsToActions(role.statements));
        return { role, missing: STAFF_ACTIONS.filter((id) => !has.has(id)) };
      })
      .sort((a, b) => a.missing.length - b.missing.length)
      .slice(0, 3);
    for (const { role, missing } of closest) {
      console.log(
        `  «${role.title}» (${role.key}) — не хватает: ${missing
          .map((id) => `«${ACTION_LABELS[id]?.label || id}»`)
          .join(", ")}`,
      );
    }
    console.log("\nСначала: node scripts/syncRoleCatalogue.js --apply");
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }
  // Ключ «admin» — если он всё ещё отдаёт весь словарь, иначе первая такая роль
  const target = fullRoles.find((role) => role.key === "admin") || fullRoles[0];
  const fullKeys = new Set(fullRoles.map((role) => role.key));
  const titleOf = (key) =>
    catalogue.find((role) => role.key === key)?.title || key;

  // --- отчёт: кто держит полный доступ сейчас ------------------------------
  const orgId = await organizationId();
  const rows = await db
    .collection("member")
    .find({ organizationId: orgId }, { projection: { userId: 1, role: 1 } })
    .toArray();
  const holderIds = rows
    .filter((row) =>
      String(row.role || "")
        .split(",")
        .some((key) => fullKeys.has(key.trim())),
    )
    .map((row) => new mongoose.Types.ObjectId(String(row.userId)));
  const holders = await db
    .collection("users")
    .find(
      { _id: { $in: holderIds } },
      { projection: { email: 1, lastName: 1, firstName: 1, banned: 1, isEndUser: 1 } },
    )
    .toArray();

  console.log(`Роль полного доступа: «${target.title}» (${target.key})`);
  console.log(`Держат полный доступ сейчас: ${holders.length}`);
  for (const user of holders) {
    const notes = [
      user.banned === true && "отключён",
      user.isEndUser !== false && "клиентская учётка — полный доступ не действует",
    ].filter(Boolean);
    console.log(
      `  ${user.lastName || ""} ${user.firstName || ""} <${user.email}>${
        notes.length ? ` — ${notes.join(", ")}` : ""
      }`,
    );
  }

  if (!emails.length) {
    console.log("\nПочты не переданы — только отчёт.");
    await mongoose.disconnect();
    return;
  }

  // --- выдача ---------------------------------------------------------------
  console.log("");
  for (const email of emails) {
    const user = await db
      .collection("users")
      .findOne(
        { email },
        { projection: { email: 1, lastName: 1, firstName: 1, isEndUser: 1 } },
      );
    if (!user) {
      console.log(`${email}: не найден — пропущен`);
      continue;
    }
    if (user.isEndUser !== false) {
      console.log(`${email}: клиентская учётная запись — роль сотрудника ей не выдаётся, пропущен`);
      continue;
    }

    const current = await roles.rolesOfMember(user._id);
    if (current.some((key) => fullKeys.has(key))) {
      console.log(`${email}: полный доступ уже есть (${current.map(titleOf).join(", ")})`);
      continue;
    }

    // Прежние роли остаются: полный доступ их перекрывает, а снять лишнее
    // человек сможет сам из интерфейса, уже администратором
    const next = [...current, target.key];
    console.log(
      `${email}: ${current.map(titleOf).join(", ") || "без ролей"} → ${next
        .map(titleOf)
        .join(", ")}${apply ? "" : " (не записано)"}`,
    );
    if (apply) await roles.assign(user._id, next, () => true);
  }

  if (!apply) console.log("\nЭто был прогон без записи. Выдать — тот же вызов с --apply.");
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
