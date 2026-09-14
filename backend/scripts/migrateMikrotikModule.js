// Одноразовый перенос рубильника Mikrotik в модули (2026-09-14). Мониторинг
// Mikrotik стал модулем наравне с базой знаний и учётом техники:
//   mikrotik.isActive → modules.mikrotik.isActive
// Отсутствие старого поля значило «включено», поэтому такие установки получают
// включённый модуль — ничего не гаснет само. Новые установки стартуют с
// выключенным модулем (дефолт схемы), как и остальные модули.
// Идемпотентен: если modules.mikrotik уже есть, значение не трогается, а старое
// поле просто убирается. Работает через нативный драйвер, потому что читает
// поле, которого в схеме уже нет.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/migrateMikrotikModule.js
require("module-alias/register");
const mongoose = require("mongoose");

const Preferences = require("../models/preferences");

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const collection = Preferences.collection;
  const document = await collection.findOne({});

  if (!document) {
    console.log("Настроек нет — переносить нечего");
    await mongoose.disconnect();
    return;
  }

  const set = {};
  const unset = {};

  if (typeof document.modules?.mikrotik?.isActive !== "boolean") {
    const isActive = document.mikrotik?.isActive !== false;
    set["modules.mikrotik.isActive"] = isActive;
    console.log(` • модуль «Мониторинг Mikrotik»: ${isActive ? "включён" : "выключен"}`);
  }
  if (document.mikrotik && "isActive" in document.mikrotik) {
    unset["mikrotik.isActive"] = "";
    console.log(" • старый рубильник mikrotik.isActive убран");
  }

  if (!Object.keys(set).length && !Object.keys(unset).length) {
    console.log("Рубильник Mikrotik уже в модулях — изменений нет");
    await mongoose.disconnect();
    return;
  }

  await collection.updateOne(
    { _id: document._id },
    {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
  );

  console.log("Готово.");
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("Не удалось перенести рубильник Mikrotik:", error);
  process.exit(1);
});
