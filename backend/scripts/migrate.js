#!/usr/bin/env node
/**
 * Раннер одноразовых миграций данных с журналом.
 *
 * Скрипты в этой папке годами запускались руками (`node scripts/<имя>.js
 * --apply`), и что из них уже прогнано на проде, нигде не записывалось.
 * Здесь — упорядоченный список и коллекция `migrations`, где каждая запись
 * помнит, что и когда применено. Сами скрипты не переписаны: раннер запускает
 * их как есть, дочерним процессом, с теми же аргументами.
 *
 *   node scripts/migrate.js status          что применено, что ждёт
 *   node scripts/migrate.js up              прогнать всё ожидающее по порядку
 *   node scripts/migrate.js baseline <id>   отметить всё до <id> включительно
 *                                           как уже применённое (без запуска)
 *   node scripts/migrate.js mark <id>       отметить одну запись (прогнали руками)
 *
 * Правила:
 *   • пустая база (нет пользователей) → `up` отмечает весь список как базу и
 *     ничего не запускает: свежий код уже пишет данные в новой форме;
 *   • непустая база без журнала → `up` ОТКАЗЫВАЕТСЯ: сперва `baseline`, иначе
 *     на живые данные поехали бы все миграции с 2026 года;
 *   • список только дописывается в конец, порядок не меняется;
 *   • первая же ошибка останавливает прогон; применённое остаётся в журнале,
 *     повторный `up` продолжает с места остановки.
 */
const path = require("path");
const { spawnSync } = require("child_process");
const mongoose = require("mongoose");

// id = <дата появления скрипта>-<имя>. `apply` — скрипту нужен флаг --apply,
// `preflight` — проверки, которые обязаны пройти (код 0) до записи.
const MIGRATIONS = [
  { id: "2026-06-16-backfillNoteApproval", script: "backfillNoteApproval.js" },
  { id: "2026-06-17-migrateDomainExpiryToServiceExpiry", script: "migrateDomainExpiryToServiceExpiry.js" },
  { id: "2026-06-22-migrateClientDeviceIndexes", script: "migrateClientDeviceIndexes.js" },
  { id: "2026-07-07-migrateMikrotikIndexes", script: "migrateMikrotikIndexes.js" },
  { id: "2026-07-16-migrateDeviceTypeAttributes", script: "migrateDeviceTypeAttributes.js" },
  { id: "2026-07-24-encryptGetScreenKeys", script: "encryptGetScreenKeys.js" },
  // ← база для прода, работавшего на коде до better-auth (июль 2026)
  { id: "2026-07-24-backfillUserLastActivity", script: "backfillUserLastActivity.js" },
  { id: "2026-07-27-migrateMailSettings", script: "migrateMailSettings.js" },
  { id: "2026-07-27-migrateWorkSchedules", script: "migrateWorkSchedules.js" }, // сеть: календарь
  { id: "2026-07-31-migrateAiProvider", script: "migrateAiProvider.js" },
  // --- better-auth: порядок значим ---
  { id: "2026-08-09-normalizeUserEmails", script: "normalizeUserEmails.js", apply: true, preflight: ["checkEmailCollisions.js"] },
  { id: "2026-08-09-backfillUserAuthFields", script: "backfillUserAuthFields.js", apply: true },
  { id: "2026-08-09-initAuthCollections", script: "initAuthCollections.js" },
  { id: "2026-08-09-migrateAuthAccounts", script: "migrateAuthAccounts.js", apply: true },
  { id: "2026-08-09-migrateUserBanned", script: "migrateUserBanned.js", apply: true },
  { id: "2026-08-09-migrateOrganization", script: "migrateOrganization.js", apply: true },
  // сухой прогон обязан пройти: незнакомый набор прав останавливает всё
  { id: "2026-08-09-assignRoles", script: "assignRoles.js", apply: true, preflight: ["assignRoles.js"] },
  { id: "2026-08-09-syncPluginRole", script: "syncPluginRole.js", apply: true },
  { id: "2026-08-10-migrateApiKeyHashes", script: "migrateApiKeyHashes.js", apply: true },
  { id: "2026-09-04-migrateAbsentWorkStatus", script: "migrateAbsentWorkStatus.js", apply: true },
  { id: "2026-09-07-resolveMapLinks", script: "resolveMapLinks.js" }, // сеть: карты
  { id: "2026-09-09-backfillTemplateFieldKeys", script: "backfillTemplateFieldKeys.js" },
  { id: "2026-09-10-backfillTicketLogKinds", script: "backfillTicketLogKinds.js" }, // долго
  { id: "2026-09-12-syncRoleCatalogue", script: "syncRoleCatalogue.js", apply: true },
  { id: "2026-09-12-migrateActions", script: "migrateActions.js", apply: true },
  { id: "2026-09-14-migrateMikrotikModule", script: "migrateMikrotikModule.js" },
];
// Намеренно НЕ в списке: eraseApiKeyValues.js (точка невозврата — руками),
// renameRoleKeys.js (инструмент дева), сиды каталогов, repair*/check*/dump*.

const LEDGER = "migrations";
const BACKEND_DIR = path.join(__dirname, "..");

const uri = `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`;

const entryById = (id) => {
  const entry = MIGRATIONS.find((item) => item.id === id);
  if (!entry) {
    console.error(`Unknown migration id: ${id}`);
    console.error("Known ids:\n  " + MIGRATIONS.map((item) => item.id).join("\n  "));
    process.exit(1);
  }
  return entry;
};

const runScript = (script, args = []) => {
  console.log(`\n→ node scripts/${script} ${args.join(" ")}`.trimEnd());
  const result = spawnSync(process.execPath, [path.join("scripts", script), ...args], {
    cwd: BACKEND_DIR,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`scripts/${script} exited with code ${result.status}`);
  }
};

const main = async () => {
  const [command, arg] = process.argv.slice(2);
  if (!["status", "up", "baseline", "mark"].includes(command)) {
    console.error("usage: node scripts/migrate.js status | up | baseline <id> | mark <id>");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const ledger = db.collection(LEDGER);
  const applied = new Set((await ledger.find({}).toArray()).map((doc) => doc._id));
  const users = await db.collection("users").countDocuments();
  const pending = MIGRATIONS.filter((entry) => !applied.has(entry.id));

  const record = (id, mode) =>
    ledger.updateOne({ _id: id }, { $setOnInsert: { appliedAt: new Date(), mode } }, { upsert: true });

  if (command === "status") {
    console.log(`database: ${users} users, ${applied.size} of ${MIGRATIONS.length} migrations applied`);
    for (const entry of MIGRATIONS) {
      console.log(`  ${applied.has(entry.id) ? "✓" : "·"} ${entry.id}`);
    }
    if (applied.size === 0 && users > 0) {
      console.log(
        "\nExisting data without a migration ledger. Before `up`, mark what already ran:\n" +
          "  node scripts/migrate.js baseline <id>\n" +
          "  (prod that ran the pre-better-auth code: 2026-07-24-backfillUserLastActivity)",
      );
    }
    return;
  }

  if (command === "baseline") {
    if (!arg) throw new Error("baseline needs an id");
    entryById(arg);
    for (const entry of MIGRATIONS) {
      await record(entry.id, "baseline");
      console.log(`  baseline ${entry.id}`);
      if (entry.id === arg) break;
    }
    return;
  }

  if (command === "mark") {
    if (!arg) throw new Error("mark needs an id");
    entryById(arg);
    await record(arg, "mark");
    console.log(`  marked ${arg}`);
    return;
  }

  // up
  if (applied.size === 0 && users === 0) {
    for (const entry of MIGRATIONS) await record(entry.id, "baseline");
    console.log("empty database: nothing to migrate, all entries recorded as baseline");
    return;
  }
  if (applied.size === 0) {
    console.error(
      "Existing data without a migration ledger — refusing to run everything blindly.\n" +
        "Mark what already ran, then retry:\n" +
        "  node scripts/migrate.js baseline <id>\n" +
        "  (prod that ran the pre-better-auth code: 2026-07-24-backfillUserLastActivity)",
    );
    process.exit(2);
  }
  if (pending.length === 0) {
    console.log("migrations: nothing pending");
    return;
  }

  console.log(`migrations: ${pending.length} pending`);
  for (const entry of pending) {
    for (const check of entry.preflight || []) runScript(check);
    runScript(entry.script, entry.apply ? ["--apply"] : []);
    await record(entry.id, "run");
    console.log(`✓ ${entry.id}`);
  }
};

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\nmigration failed: ${error.message}`);
    process.exit(1);
  });
