require("module-alias/register");
const mongoose = require("mongoose");

const Company = require("../models/company");
const Subdivision = require("../models/subdivision");
const { resolveMapLink } = require("../services/mapLink");

// Точки для уже сохранённых ссылок на карту: компании и подразделения, у
// которых ссылка есть, а `location` нет. Короткие ссылки «Поделиться»
// раскрываются по одной, с паузой. Запускать один раз при выкатке (в том
// числе на проде): из контейнера бэкенда — node scripts/resolveMapLinks.js.
// Повторный запуск безопасен: записи с точкой пропускаются.
const PAUSE_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const targets = [
    [Company, "компании", (doc) => doc.alias],
    [Subdivision, "подразделения", (doc) => doc.name],
  ];

  for (const [Model, label, nameOf] of targets) {
    const docs = await Model.find({
      linkToMap: { $nin: [null, ""] },
      "location.lat": { $exists: false },
    })
      .select("_id alias name linkToMap")
      .lean();

    let found = 0;
    for (const doc of docs) {
      const location = await resolveMapLink(doc.linkToMap);
      if (location) {
        await Model.updateOne({ _id: doc._id }, { $set: { location } });
        found += 1;
      } else {
        console.log(`  без точки: ${nameOf(doc)} — ${doc.linkToMap}`);
      }
      await sleep(PAUSE_MS);
    }
    console.log(`${label}: ссылок без точки ${docs.length}, точек найдено ${found}`);
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
