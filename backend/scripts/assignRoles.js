// Заводит роли из каталога и раздаёт их людям. Главный шаг этапа ролей.
//
// ДВА ПРАВИЛА РАЗДАЧИ, по адресату роли:
//
//  • СОТРУДНИКИ — ПОИМЁННО. Роли сотрудников перечисляют людей по почте
//    (`members` в каталоге): раздача сделана руками на деве, и на проде она
//    повторяется один в один. Сотрудник, не названный ни в одной роли,
//    ОСТАНАВЛИВАЕТ скрипт — приписать ему роль по старым галочкам молча нельзя.
//    Почта названа, а человека нет — тоже остановка: каталог отстал от прода.
//
//  • КЛИЕНТЫ — ПО ПОДПИСИ ПРАВ. Клиентов сотни, и их роли выводятся из
//    доролевых галочек: скрипт смотрит, какой набор у человека фактически, и
//    находит клиентскую роль, которая этот набор поглощает (`matches`).
//    Незнакомая подпись останавливает скрипт и печатает человека поимённо: на
//    проде наборы могли уйти вперёд от копии.
//
// Поимённая раздача главнее подписи: названному человеку его галочки не читают.
//
// ЗАПИСЫВАЕТ ТОЛЬКО В ПУСТУЮ РАЗДАЧУ. Если хоть у кого-то роль уже стоит,
// `--apply` отказывает: повторный прогон на базе, где галочек уже нет, раздал
// бы клиентам роль с пустым набором. Проверено на своей шкуре: 696 членств
// стали «Клиент» одной командой. Без `--apply` показ работает всегда и печатает
// отличия плана от текущей раздачи.
//
// `--rollback` чистит `member.role` — но ПРАВА ПРИ ЭТОМ НЕ ВОЗВРАЩАЮТСЯ: личные
// галочки в документах остаются нетронутыми, однако приложение их больше не
// читает (`services/permissions.js`). Откат этого релиза — предыдущий образ;
// тот код снова прочитает те же документы, потому что скрипт не трогает
// `user.permissions` НИКОГДА.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/assignRoles.js             # показать план и изменения прав
//   node scripts/assignRoles.js --apply     # записать
//   node scripts/assignRoles.js --rollback  # снять все роли
require("module-alias/register");
const fs = require("fs");
const mongoose = require("mongoose");

const { PERMISSION_KEYS, legacyToActions } = require("./legacyPermissions");
const { syncCatalogue, CATALOGUE } = require("./syncRoleCatalogue");
const { actionsToStatements } = require("@/auth/access");
const { ORG_SLUG } = require("@/services/permissions");
const { refreshMirrorForUsers } = require("@/services/roles");

/** Подпись набора — права в порядке PERMISSION_KEYS, через запятую. */
const signature = (keys) =>
  PERMISSION_KEYS.filter((key) => keys.includes(key)).join(",");

const displayName = (user) =>
  `${user.lastName || ""} ${user.firstName || ""}`.trim() || user.email;

/** Клиент — все, кто не помечен сотрудником явно: так читает и вход по ссылке. */
const isClient = (user) => user.isEndUser !== false;

/**
 * План раздачи. Чистая функция: базу не трогает, чтобы её можно было проверить
 * на выдуманных людях.
 *
 * @param {object[]} roles — каталог
 * @param {object[]} users — люди без служебных: `_id`, `email`, `isEndUser`,
 *   `permissions`, имя
 * @returns {{ plan: object[], problems: object[] }} план — по строке на
 *   человека (`roles` — ключи в порядке каталога); проблемы — то, из-за чего
 *   записывать нельзя
 */
const planAssignments = ({ roles, users }) => {
  const problems = [];

  // --- поимённо: почта → человек, человек → роли ---------------------------
  const byEmail = new Map(
    users.map((user) => [String(user.email || "").trim().toLowerCase(), user]),
  );
  const pinned = new Map();
  for (const role of roles) {
    if (role.audience === "client" && role.members?.length) {
      problems.push({
        kind: "catalogue",
        text: `у клиентской роли «${role.title}» перечислены люди — клиентов раздают по подписям (matches)`,
      });
    }
    if (role.audience !== "client" && role.matches?.length) {
      problems.push({
        kind: "catalogue",
        text: `у роли сотрудников «${role.title}» есть подписи — сотрудников раздают поимённо (members)`,
      });
    }
    for (const raw of role.members || []) {
      const email = String(raw).trim().toLowerCase();
      const user = byEmail.get(email);
      if (!user) {
        problems.push({
          kind: "missing",
          text: `${email} — назван в роли «${role.title}», но такой учётной записи нет (или она служебная)`,
        });
        continue;
      }
      const id = String(user._id);
      if (!pinned.has(id)) pinned.set(id, []);
      if (!pinned.get(id).includes(role.key)) pinned.get(id).push(role.key);
    }
  }

  // --- по подписи: только клиентские роли ---------------------------------
  const bySignature = new Map();
  for (const role of roles) {
    if (role.audience !== "client") continue;
    for (const match of role.matches || []) {
      const key = signature(match);
      if (bySignature.has(key)) {
        problems.push({
          kind: "catalogue",
          text:
            `подпись «${key || "(нет прав)"}» описана дважды: ` +
            `«${bySignature.get(key).title}» и «${role.title}»`,
        });
      }
      bySignature.set(key, role);
    }
  }

  const byKey = new Map(roles.map((role) => [role.key, role]));
  const plan = [];
  for (const user of users) {
    const own = PERMISSION_KEYS.filter((key) => user.permissions?.[key]);
    const ownActions = legacyToActions(user.permissions || {});

    let keys = pinned.get(String(user._id));
    let how = "pinned";
    if (!keys) {
      if (!isClient(user)) {
        problems.push({
          kind: "staff",
          text:
            `${displayName(user)} <${user.email}> — сотрудник, не названный ни в одной роли` +
            `\n      галочки: ${own.join(", ") || "(нет)"}`,
        });
        continue;
      }
      const role = bySignature.get(signature(own));
      if (!role) {
        problems.push({
          kind: "signature",
          text:
            `${displayName(user)} <${user.email}> — клиент с набором, которого нет в каталоге` +
            `\n      галочки: ${own.join(", ") || "(нет)"}`,
        });
        continue;
      }
      keys = [role.key];
      how = "signature";
    }

    // Сравниваем в НОВОМ языке: подпись человека — доролевая, набор роли —
    // словарь. Прежние галочки переводятся расширением (`legacyToActions`),
    // поэтому «получит» показывает настоящую разницу, а не разницу словарей.
    const roleActions = [
      ...new Set(keys.flatMap((key) => byKey.get(key)?.actions || [])),
    ];
    plan.push({
      user,
      roles: keys,
      how,
      gained: roleActions.filter((id) => !ownActions.includes(id)),
      lost: ownActions.filter((id) => !roleActions.includes(id)),
    });
  }

  return { plan, problems };
};

const run = async () => {
  const apply = process.argv.includes("--apply");
  const rollback = process.argv.includes("--rollback");

  const { roles } = JSON.parse(fs.readFileSync(CATALOGUE, "utf8"));

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const db = mongoose.connection.db;

  // Показ работает и ДО организации — это разведка перед окном, и она обязана
  // быть чтением. Запись без организации невозможна: членство заводит
  // migrateOrganization.js.
  const org = await db.collection("organization").findOne({ slug: ORG_SLUG });
  if (!org && (apply || rollback)) {
    throw new Error(
      "Организации нет — сначала scripts/migrateOrganization.js --apply",
    );
  }
  const orgId = org ? String(org._id) : null;

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

  const users = await db
    .collection("users")
    .find(
      { isServiceAccount: { $ne: true } },
      {
        projection: {
          permissions: 1,
          isEndUser: 1,
          banned: 1,
          firstName: 1,
          lastName: 1,
          email: 1,
        },
      },
    )
    .toArray();

  const members = orgId
    ? await db
        .collection("member")
        .find({ organizationId: orgId }, { projection: { userId: 1, role: 1 } })
        .toArray()
    : [];
  const currentRole = new Map(
    members.map((member) => [String(member.userId), String(member.role || "")]),
  );
  const alreadyAssigned = members.filter((member) =>
    String(member.role || "").trim(),
  ).length;

  const { plan, problems } = planAssignments({ roles, users });

  if (problems.length) {
    console.error(`\nОСТАНОВЛЕНО: ${problems.length} причин(ы), из-за которых записывать нельзя.\n`);
    for (const problem of problems) console.error(`  [${problem.kind}] ${problem.text}`);
    console.error(
      "\nСотрудников добавьте в members нужной роли, клиентские наборы — в matches " +
        "(scripts/roles.catalogue.json), либо поправьте права людям.",
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  // --- отчёт ---------------------------------------------------------------

  const counts = new Map();
  for (const item of plan) {
    for (const key of item.roles) counts.set(key, (counts.get(key) || 0) + 1);
  }
  console.log("Раздача ролей:\n");
  for (const role of roles) {
    const how = role.audience === "client" ? "по подписи" : "поимённо";
    console.log(`  ${role.title} — ${counts.get(role.key) || 0} чел. (${how})`);
  }

  console.log("\nСотрудники:\n");
  for (const item of plan.filter((row) => row.how === "pinned")) {
    const titles = item.roles.map((key) => roles.find((role) => role.key === key)?.title || key);
    console.log(
      `  ${displayName(item.user)} <${item.user.email}>${item.user.banned ? " (отключён)" : ""}` +
        ` → ${titles.join(" + ")}`,
    );
  }

  const differs = plan.filter((item) => {
    const now = currentRole.get(String(item.user._id));
    return now !== undefined && now !== item.roles.join(",");
  });
  if (alreadyAssigned) {
    console.log(
      `\nРоли уже стоят у ${alreadyAssigned} чел.; план расходится с ними у ${differs.length}:`,
    );
    for (const item of differs) {
      console.log(
        `  ${displayName(item.user)}: «${currentRole.get(String(item.user._id)) || "—"}» → «${item.roles.join(",")}»`,
      );
    }
  }

  const changed = plan.filter((item) => item.gained.length || item.lost.length);
  console.log(
    `\nРоль отличается от собственного набора у ${changed.length} чел. из ${plan.length}:`,
  );
  for (const item of changed) {
    console.log(`\n  ${displayName(item.user)} → «${item.roles.join(", ")}»`);
    if (item.gained.length) console.log(`    + ${item.gained.join(", ")}`);
    // «−» НЕ означает потерю доступа прямо сейчас — в этом релизе галочки
    // уже не читаются, так что это список к осознанной проверке того, чего
    // у человека НЕ БУДЕТ после переключения.
    if (item.lost.length) {
      console.log(`    − ${item.lost.join(", ")}  (в роль не входит)`);
    }
  }
  if (!changed.length) console.log("  ни у кого — раздача чисто структурная");

  const withoutMember = plan.filter(
    (item) => !currentRole.has(String(item.user._id)),
  );
  if (!orgId) {
    console.log("\nОрганизации ещё нет: членство заведёт migrateOrganization.js --apply.");
  } else if (withoutMember.length) {
    console.log(
      `\nБез членства (нужен migrateOrganization.js --apply): ${withoutMember
        .map((item) => item.user.email)
        .join(", ")}`,
    );
  }

  if (!apply) {
    console.log("\nПоказ без записи. Повторите с --apply.");
    await mongoose.disconnect();
    return;
  }

  if (alreadyAssigned) {
    throw new Error(
      `Раздача уже выполнена: роль стоит у ${alreadyAssigned} чел. Повторная запись ` +
        "затёрла бы её. Роли отдельным людям меняют в интерфейсе.",
    );
  }
  if (withoutMember.length) {
    throw new Error("У части людей нет членства — сначала migrateOrganization.js --apply");
  }

  // --- запись --------------------------------------------------------------

  // Тот же код, что и у `syncRoleCatalogue.js`: каталог обязан выглядеть
  // одинаково, кем бы его ни записали.
  await syncCatalogue(db, orgId, roles, { actionsToStatements });
  console.log(`\nРолей в каталоге: ${roles.length}`);

  let assigned = 0;
  for (const item of plan) {
    const result = await db
      .collection("member")
      .updateOne(
        { organizationId: orgId, userId: String(item.user._id) },
        { $set: { role: item.roles.join(",") } },
      );
    assigned += result.modifiedCount;
  }
  console.log(`Роль проставлена: ${assigned} чел.`);

  // Зеркало `isAdmin` и роль плагина — тем же кодом, что и назначение из
  // интерфейса: иначе администратором остался бы тот, кому роль полного
  // доступа не досталась, а получивший её не стал бы им до первой правки.
  const mirrored = await refreshMirrorForUsers(
    orgId,
    plan.map((item) => String(item.user._id)),
  );
  const admins = await db.collection("users").countDocuments({ isAdmin: true });
  console.log(`Зеркало isAdmin пересчитано у ${mirrored} чел.; администраторов: ${admins}`);

  const withoutRole = await db
    .collection("member")
    .countDocuments({ organizationId: orgId, role: "" });
  console.log(`Осталось без роли: ${withoutRole} (ожидается 0)`);

  await mongoose.disconnect();
};

module.exports = { planAssignments, signature };

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
