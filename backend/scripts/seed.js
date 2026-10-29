#!/usr/bin/env node
/**
 * Раннер сидов — начальных данных каталога (группы атрибутов, типы, атрибуты),
 * с журналом. По образцу migrate.js, но:
 *   • сиды прогоняются и на ПУСТОЙ базе: новой установке каталог нужен так же,
 *     как работающей (у миграций на пустой базе всё отмечается как база);
 *   • сид — модуль из scripts/seeds/, он исполняется в этом же процессе:
 *     `await require(<модуль>).apply({ log })`.
 *
 *   node scripts/seed.js status       что применено, что ждёт
 *   node scripts/seed.js up           прогнать неприменённые по порядку
 *   node scripts/seed.js mark <id>    отметить без запуска (пропустить сид)
 *
 * На хосте — `./deploy.sh seed <команда>`, на деве —
 * `docker compose run --rm backend node scripts/seed.js <команда>`. С хоста
 * к базе дева: `MONGODB_HOST=localhost node scripts/seed.js status`.
 *
 * Правила:
 *   • сид только добавляет и подхватывает существующее по имени, поэтому
 *     повторный прогон безопасен; но применённый сид больше не запускается —
 *     то, что владелец переименовал или удалил после него, не воскресает;
 *   • список только дописывается в конец, порядок не меняется;
 *   • первая же ошибка останавливает прогон (код 1); применённое остаётся в
 *     журнале, повторный `up` продолжает с места остановки.
 */
const path = require("path");
const mongoose = require("mongoose");

// id = <дата появления сида>-<имя>; module — путь от scripts/.
const SEEDS = [
  { id: "2026-10-19-inventoryCatalog", module: "./seeds/2026-10-19-inventoryCatalog" },
  { id: "2026-10-19-systemUnitAssembly", module: "./seeds/2026-10-19-systemUnitAssembly" },
  { id: "2026-10-29-deviceSystemAttributes", module: "./seeds/2026-10-29-deviceSystemAttributes" },
];

const LEDGER = "seeds";

/** Неприменённые сиды в порядке списка. */
const pendingSeeds = (seeds, appliedIds) => {
  const applied = new Set(appliedIds);
  return seeds.filter((entry) => !applied.has(entry.id));
};

const entryById = (id) => {
  const entry = SEEDS.find((item) => item.id === id);
  if (!entry) {
    console.error(`Unknown seed id: ${id}`);
    console.error("Known ids:\n  " + (SEEDS.map((item) => item.id).join("\n  ") || "(none)"));
    process.exit(1);
  }
  return entry;
};

const main = async () => {
  const [command, arg] = process.argv.slice(2);
  if (!["status", "up", "mark"].includes(command)) {
    console.error("usage: node scripts/seed.js status | up | mark <id>");
    process.exit(1);
  }

  // В compose база — сервис `mongodb`; с хоста — MONGODB_HOST=localhost.
  const host = process.env.MONGODB_HOST || "mongodb";
  const { MONGODB_USERNAME, MONGODB_PASSWORD, MONGODB_DATABASE } = process.env;
  const uri =
    `mongodb://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@${host}:27017/` +
    `${MONGODB_DATABASE}?authSource=admin`;
  await mongoose.connect(uri);
  const ledger = mongoose.connection.db.collection(LEDGER);
  const appliedIds = (await ledger.find({}).toArray()).map((doc) => doc._id);
  const applied = new Set(appliedIds);
  const pending = pendingSeeds(SEEDS, appliedIds);

  const record = (id, mode) =>
    ledger.updateOne(
      { _id: id },
      { $setOnInsert: { appliedAt: new Date(), mode } },
      { upsert: true },
    );

  if (command === "status") {
    console.log(`seeds: ${SEEDS.length - pending.length} of ${SEEDS.length} applied`);
    for (const entry of SEEDS) {
      console.log(`  ${applied.has(entry.id) ? "✓" : "·"} ${entry.id}`);
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
  if (pending.length === 0) {
    console.log("seeds: nothing pending");
    return;
  }
  console.log(`seeds: ${pending.length} pending`);
  for (const entry of pending) {
    console.log(`\n→ ${entry.id}`);
    const seed = require(path.join(__dirname, entry.module));
    await seed.apply({ log: (line) => console.log(`  ${line}`) });
    await record(entry.id, "run");
    console.log(`✓ ${entry.id}`);
  }
};

if (require.main === module) {
  main()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`\nseed failed: ${error.stack || error.message}`);
      process.exit(1);
    });
}

module.exports = { SEEDS, pendingSeeds };
