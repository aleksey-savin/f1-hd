// Серийный номер устройства перестал быть уникальным, 2026-10-16.
//
// Модель давно объявляет `{ serialNumber: 1 }` без unique (совпадение — лишь
// предупреждение формы), но Mongoose существующий индекс не пересоздаёт: на
// старых базах остался `serialNumber_1` с unique и без partialFilter. Под ним
// все устройства без серийника — это null, и второе такое (своя сборка) не
// сохраняется: «Конфликт уникальности по полю serialNumber».
//
// Скрипт заменяет этот индекс обычным с тем же ключом. Данные не трогает.
// Идемпотентен: нет индекса или он уже не unique — ничего не делает.
//   node scripts/dropUniqueSerialIndex.js            # показать
//   node scripts/dropUniqueSerialIndex.js --apply    # заменить
const INDEX = "serialNumber_1";

const run = async () => {
  const mongoose = require("mongoose");
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  const collection = mongoose.connection.db.collection("clientdevices");

  const indexes = await collection.indexes().catch(() => []);
  const stale = indexes.find((index) => index.name === INDEX && index.unique);

  if (!stale) {
    console.log(`  Уникального индекса ${INDEX} нет — менять нечего.`);
  } else if (!apply) {
    console.log(`  Найден уникальный ${INDEX}. Показ без записи. Повторите с --apply.`);
  } else {
    await collection.dropIndex(INDEX);
    await collection.createIndex({ serialNumber: 1 }, { name: INDEX, background: true });
    console.log(`  ${INDEX} пересоздан без unique.`);
  }

  await mongoose.disconnect();
};

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
