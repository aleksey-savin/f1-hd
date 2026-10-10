// Разовый перенос прошлого в журнал устройств Mikrotik (MikrotikEvent), 2026-10-11.
//
// Журнал ведётся с момента выката; чтобы он не был пустым, сюда переносится то,
// что HD уже хранит: простои (MikrotikOutage), обновления (MikrotikUpgradeJob),
// запросы ИИ-агентов (MikrotikChange) и копии конфигурации (MikrotikArtifact).
// Перезагрузок вне обновлений, правок записи и строк лога роутера за прошлое
// нет — их никто не хранил.
//
// Берутся события за срок хранения журнала и ТОЛЬКО до первого события,
// записанного самим журналом: дальше он пишет их сам. Ничего не удаляет и не
// меняет в исходных коллекциях; у каждого события dedupeKey — повторный прогон
// ничего не добавляет. Запись удалённого устройства пропускается.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/backfillMikrotikEvents.js            # показать
//   node scripts/backfillMikrotikEvents.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const Mikrotik = require("@/models/mikrotik");
const MikrotikEvent = require("@/models/mikrotikEvent");
const MikrotikOutage = require("@/models/mikrotikOutage");
const MikrotikUpgradeJob = require("@/models/mikrotikUpgradeJob");
const MikrotikChange = require("@/models/mikrotikChange");
const MikrotikArtifact = require("@/models/mikrotikArtifact");
const { createEventLog, mongoStore } = require("@/services/mikrotik/events");
const { fromOutage, fromUpgradeItem, fromChange, fromArtifacts, inWindow } = require("@/services/mikrotik/eventBackfill");

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const now = new Date();
  const from = new Date(now.getTime() - MikrotikEvent.RETENTION_DAYS * 86400000);
  // Первое событие, записанное самим журналом (у перенесённых есть dedupeKey)
  const firstLive = await MikrotikEvent.findOne({ dedupeKey: { $exists: false } }).sort({ at: 1 }).select("at").lean();
  const before = firstLive?.at || now;
  const alive = new Set((await Mikrotik.find({}).distinct("_id")).map(String));

  const [outages, jobs, changes, artifacts] = await Promise.all([
    MikrotikOutage.find({}).lean(),
    MikrotikUpgradeJob.find({}).lean(),
    MikrotikChange.find({}).lean(),
    MikrotikArtifact.find({ type: "export" }).sort({ createdAt: 1 }).lean(),
  ]);
  const byDevice = new Map();
  for (const artifact of artifacts) {
    const key = String(artifact.mikrotik);
    byDevice.set(key, [...(byDevice.get(key) || []), artifact]);
  }

  const sources = {
    "простои": outages.flatMap(fromOutage),
    "обновления": jobs.flatMap((job) => (job.items || []).flatMap((item) => fromUpgradeItem(job, item))),
    "запросы агентов": changes.flatMap(fromChange),
    "копии конфигурации": [...byDevice.values()].flatMap(fromArtifacts),
  };

  const events = createEventLog({ store: mongoStore, log: { log: (level, message, meta) => console.log(`  ! ${message}`, meta) } });
  const had = await MikrotikEvent.countDocuments({});
  console.log(`Журнал: ${had} событий. Окно переноса: ${from.toISOString()} … ${before.toISOString()}`);

  for (const [label, all] of Object.entries(sources)) {
    const wanted = inWindow(all, { from, before }).filter((event) => alive.has(String(event.mikrotik)));
    console.log(`  ${label}: ${wanted.length} событий (из ${all.length})`);
    if (!apply) continue;
    for (const { mikrotik, kind, ...fields } of wanted) await events.record(mikrotik, kind, fields);
  }

  if (apply) console.log(`Записано. В журнале ${await MikrotikEvent.countDocuments({})} событий (было ${had}).`);
  else console.log("Ничего не записано: это показ. Для записи — --apply.");
};

run()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
  });
