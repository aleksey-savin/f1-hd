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
 *   node scripts/migrate.js pending         код 0 — ждать нечего, 3 — есть
 *                                           ожидающие, 2 — база без журнала
 *   node scripts/migrate.js up              прогнать всё ожидающее по порядку
 *   node scripts/migrate.js baseline <id>   отметить всё до <id> включительно
 *                                           как уже применённое (без запуска)
 *   node scripts/migrate.js mark <id>       отметить одну запись (прогнали руками)
 *
 * На хосте всё это зовётся через `./deploy.sh migrate <команда>`, на деве —
 * `docker compose run --rm backend node scripts/migrate.js <команда>`.
 *
 * Правила:
 *   • пустая база (нет пользователей) → `up` отмечает весь список как базу и
 *     ничего не запускает: свежий код уже пишет данные в новой форме;
 *   • непустая база без журнала → `up` ОТКАЗЫВАЕТСЯ: такие данные старше
 *     списка, и прогнать его вслепую нельзя;
 *   • список только дописывается в конец, порядок не меняется. Записи,
 *     применённые на всех установках, вычищаются вместе со скриптами: сейчас
 *     база — последний коммит до «Диалогов» (61d49c6). Лишние записи в журнале
 *     раннеру не мешают;
 *   • первая же ошибка останавливает прогон; применённое остаётся в журнале,
 *     повторный `up` продолжает с места остановки.
 */
const path = require("path");
const { spawnSync } = require("child_process");
const mongoose = require("mongoose");

// id = <дата появления скрипта>-<имя>. `apply` — скрипту нужен флаг --apply,
// `preflight` — проверки, которые обязаны пройти (код 0) до записи.
const MIGRATIONS = [
  // Только дописывает `conversation.*`; см. grantConversations.js
  { id: "2026-09-25-grantConversations", script: "grantConversations.js", apply: true },
  { id: "2026-09-25-initMessaging", script: "initMessaging.js", apply: true },
  // Телефоны — только цифрами с кодом страны; см. normalizePhones.js
  { id: "2026-09-30-normalizePhones", script: "normalizePhones.js", apply: true },
];
// Намеренно НЕ в списке: eraseApiKeyValues.js (точка невозврата — руками),
// renameRoleKeys.js и syncRoleCatalogue.js (инструменты дева), сиды каталогов,
// repair*/check*/dump*.

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

const BASELINE_HINT =
  "This code upgrades only data that already has the ledger (commit 61d49c6 or later).\n" +
  "Older data: deploy that commit first. Or mark what already ran by hand, then retry:\n" +
  "  ./deploy.sh migrate baseline <id>          (dev: docker compose run --rm backend node scripts/migrate.js baseline <id>)";

const main = async () => {
  const [command, arg] = process.argv.slice(2);
  if (!["status", "pending", "up", "baseline", "mark"].includes(command)) {
    console.error("usage: node scripts/migrate.js status | pending | up | baseline <id> | mark <id>");
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
      console.log("\nExisting data without a migration ledger. " + BASELINE_HINT);
    }
    return;
  }

  // Пустая база: свежий код уже пишет данные в новой форме, миграций нет.
  // Отмечается и из `pending`, чтобы следующий деплой не принял заведённого
  // администратора за «данные без журнала».
  const recordFreshBaseline = async () => {
    for (const entry of MIGRATIONS) await record(entry.id, "baseline");
    console.log("empty database: nothing to migrate, all entries recorded as baseline");
  };

  if (command === "pending") {
    if (applied.size === 0 && users === 0) {
      await recordFreshBaseline();
      return;
    }
    if (applied.size === 0) {
      console.error("Existing data without a migration ledger. " + BASELINE_HINT);
      process.exit(2);
    }
    console.log(`migrations: ${pending.length} pending`);
    if (pending.length) process.exit(3);
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
    await recordFreshBaseline();
    return;
  }
  if (applied.size === 0) {
    console.error(
      "Existing data without a migration ledger — refusing to run everything blindly.\n" + BASELINE_HINT,
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
