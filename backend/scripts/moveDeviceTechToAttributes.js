// Разовый перенос полей карточки устройства ipAddress, macAddress и
// operatingSystem в атрибуты уровня устройства, 2026-10-29 (план
// docs/superpowers/plans/2026-10-29-device-instance-attributes.md).
//
// С этого кода IP, MAC и ОС — системные атрибуты (services/inventory/
// systemDeviceAttributes), значения в ClientDevice.attributes. Скрипт:
//   • находит или создаёт три атрибута; ОС на уровне модели переводит на
//     устройство, а если в конфигурациях у неё есть значения — останавливается;
//   • связывает нужные атрибуты с эффективным типом каждого устройства
//     (тип модели, иначе прямой), у которого есть что переносить;
//   • пишет значения в attributes и снимает старые поля ($unset) у всех
//     устройств, включая удалённые.
// Ничего не удаляет, кроме старых полей после переноса. Запись — по _id И по
// прочитанным значениям старых полей: изменённое между чтением и записью не
// совпадёт и будет перечислено. Повторный прогон не находит документов со
// старыми полями и ничего не меняет. Отчёт — только счётчики, имена типов и _id.
//
// Запускать при остановленном приложении: deploy.sh так и делает, когда есть
// ожидающие миграции. Не совпавшее перечисляется, прогон завершается кодом 1,
// и раннер не записывает миграцию в журнал.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/moveDeviceTechToAttributes.js            # показать
//   node scripts/moveDeviceTechToAttributes.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const DeviceModel = require("@/models/inventory/deviceModel");
const DeviceType = require("@/models/inventory/deviceType");
const ClientDevice = require("@/models/inventory/clientDevice");
const {
  FIELD_BY_KEY,
  ensureSystemAttributes,
  ensureTypeLinks,
  withSystemValues,
} = require("@/services/inventory/systemDeviceAttributes");

const FIELDS = Object.values(FIELD_BY_KEY);
const filled = (value) => typeof value === "string" && value.trim() !== "";

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  // Старых полей в схеме больше нет — читаем и пишем коллекцию напрямую
  const devices = ClientDevice.collection;
  const docs = await devices
    .find({ $or: FIELDS.map((field) => ({ [field]: { $exists: true } })) })
    .project({ deviceModelId: 1, deviceTypeId: 1, attributes: 1, ...Object.fromEntries(FIELDS.map((f) => [f, 1])) })
    .toArray();

  const models = await DeviceModel.find({ _id: { $in: docs.map((d) => d.deviceModelId).filter(Boolean) } })
    .select("deviceTypeId")
    .lean();
  const typeByModel = new Map(models.map((m) => [String(m._id), m.deviceTypeId]));
  const typeOf = (doc) => (doc.deviceModelId ? typeByModel.get(String(doc.deviceModelId)) : doc.deviceTypeId) || null;
  const types = await DeviceType.find({ _id: { $in: docs.map(typeOf).filter(Boolean) } })
    .select("name")
    .lean();
  const typeName = new Map(types.map((t) => [String(t._id), t.name]));

  const withValues = docs.filter((doc) => FIELDS.some((field) => filled(doc[field])));
  console.log(`Устройств со старыми полями: ${docs.length}, из них со значениями: ${withValues.length}`);
  for (const field of FIELDS) {
    console.log(`  ${field}: ${docs.filter((doc) => filled(doc[field])).length}`);
  }
  const byType = new Map();
  for (const doc of withValues) {
    const id = typeOf(doc);
    const name = id ? typeName.get(String(id)) || `тип ${id}` : "без типа";
    byType.set(name, (byType.get(name) || 0) + 1);
  }
  console.log("По типам:");
  for (const [name, count] of [...byType].sort((a, b) => b[1] - a[1])) console.log(`  ${name}: ${count}`);
  const untyped = withValues.filter((doc) => !typeOf(doc));
  if (untyped.length) {
    console.log("Без типа — значения перенесутся, но в форме не покажутся, пока тип не задан:");
    for (const doc of untyped) console.log(`  ${doc._id}`);
  }

  if (!apply) {
    console.log("\nПоказ без записи. Повторите с --apply.");
    await mongoose.disconnect();
    return;
  }

  const ids = await ensureSystemAttributes({ log: (line) => console.log(`  ${line}`) });
  const keyByField = Object.fromEntries(Object.entries(FIELD_BY_KEY).map(([key, field]) => [field, key]));

  // Связки — один раз на тип, только с тем, что у его устройств заполнено
  const neededByType = new Map();
  for (const doc of withValues) {
    const typeId = typeOf(doc);
    if (!typeId) continue;
    const needed = neededByType.get(String(typeId)) || { typeId, keys: new Set() };
    for (const field of FIELDS) if (filled(doc[field])) needed.keys.add(keyByField[field]);
    neededByType.set(String(typeId), needed);
  }
  for (const { typeId, keys } of neededByType.values()) {
    await ensureTypeLinks(
      typeId,
      [...keys].map((key) => ids[key]),
    );
  }

  let moved = 0;
  const missed = [];
  for (const doc of docs) {
    const patch = {};
    for (const field of FIELDS) if (filled(doc[field])) patch[field] = doc[field].trim();
    // Страж — прочитанные значения старых полей (отсутствующее — «нет поля»)
    const guard = { _id: doc._id };
    for (const field of FIELDS) guard[field] = field in doc ? doc[field] : { $exists: false };
    const update = { $unset: Object.fromEntries(FIELDS.map((field) => [field, ""])) };
    if (Object.keys(patch).length) update.$set = { attributes: withSystemValues(doc, patch, ids) };
    const result = await devices.updateOne(guard, update);
    if (result.matchedCount) moved += result.modifiedCount;
    else missed.push(`  устройство ${doc._id}: поля изменились после чтения`);
  }

  console.log(`\nОбновлено устройств: ${moved} из ${docs.length}.`);
  if (missed.length) {
    console.log("Не совпали со стражем (не тронуты):");
    for (const line of missed) console.log(line);
    console.log("Прогон не завершён, код выхода 1: раннер не запишет миграцию в журнал. Повторите.");
    process.exitCode = 1;
  }
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
