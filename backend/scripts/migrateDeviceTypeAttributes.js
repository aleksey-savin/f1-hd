/**
 * Одноразовая миграция связей «тип устройства ↔ атрибут».
 *
 * Старые документы DeviceType хранили атрибуты легаси-полем прямо в документе
 * ({ attributeId, isRequired, displayOrder }); актуальная схема — отдельная
 * коллекция DeviceTypeAttribute ({ required, extendable, order }), из которой
 * читают getOne/формы. Скрипт переносит легаси-поле в коллекцию связей для
 * типов, у которых связей ещё нет, и вычищает легаси-поле ($unset).
 *
 * Запуск (из контейнера backend):
 *   node scripts/migrateDeviceTypeAttributes.js
 */
const mongoose = require("mongoose");

const uri = `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`;

async function run() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const deviceTypes = db.collection("devicetypes");
  const links = db.collection("devicetypeattributes");

  const withLegacy = await deviceTypes
    .find({ "attributes.0": { $exists: true } })
    .toArray();

  let migrated = 0;
  let skipped = 0;

  for (const deviceType of withLegacy) {
    const existingLinks = await links.countDocuments({
      deviceTypeId: deviceType._id,
    });

    if (existingLinks > 0) {
      // Связи уже есть (тип правили в новой схеме) — легаси-поле просто мусор
      skipped++;
    } else {
      const docs = (deviceType.attributes || [])
        .filter((attr) => attr.attributeId)
        .map((attr, index) => ({
          deviceTypeId: deviceType._id,
          attributeId: attr.attributeId,
          required: attr.isRequired ?? attr.required ?? false,
          extendable: attr.extendable ?? false,
          order: attr.displayOrder ?? attr.order ?? index,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      if (docs.length > 0) {
        await links.insertMany(docs);
        migrated++;
      }
    }

    await deviceTypes.updateOne(
      { _id: deviceType._id },
      { $unset: { attributes: "" } },
    );
  }

  console.log(
    `Done. Types with legacy field: ${withLegacy.length}, migrated: ${migrated}, cleaned only: ${skipped}`,
  );
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
