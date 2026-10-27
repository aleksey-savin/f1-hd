// Разовый переход моделей устройств на режим одной конфигурации, 2026-10-27
// (план docs/superpowers/plans/2026-10-27-model-single-configuration.md).
//
// С этого кода у живой модели всегда есть хотя бы одна конфигурация, а
// устройство модели с единственной конфигурацией привязано к ней
// (services/inventory/modelConfigurations). Скрипт приводит старые данные:
//   • модели без конфигураций получают пустую;
//   • модели с двумя и больше переходят в режим «Несколько конфигураций»
//     (флаг multiConfig) — их карточка остаётся с вариантами, как была;
//   • живые устройства без конфигурации, чья модель вне режима нескольких и с
//     единственной конфигурацией, привязываются к ней.
// Ничего не удаляет. Записи — по _id с условием-стражем (у модели режим ещё не
// включён, у устройства конфигурации ещё нет, у модели всё ещё нет
// конфигураций), так что повторный прогон ничего не дублирует. Отчёт — только
// счётчики и _id.
//
// Запускать при остановленном приложении: deploy.sh так и делает, когда есть
// ожидающие миграции. Не совпавшая со стражем запись перечисляется, прогон
// завершается кодом 1, и раннер не записывает миграцию в журнал.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/singleModelConfigurations.js            # показать
//   node scripts/singleModelConfigurations.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const DeviceModel = require("@/models/inventory/deviceModel");
const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
const ClientDevice = require("@/models/inventory/clientDevice");
const { planModelConfigMigration } = require("@/services/inventory/modelConfigurations");

const load = async () => {
  const models = await DeviceModel.find({ deletedAt: null }).select("multiConfig").lean();
  const configs = await DeviceConfiguration.find({ deletedAt: null })
    .select("deviceModelId createdAt")
    .lean();
  const devices = await ClientDevice.find({
    deletedAt: null,
    deviceModelId: { $ne: null },
    configurationId: null,
  })
    .select("deviceModelId")
    .lean();
  return { models, configs, devices };
};

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const data = await load();
  const plan = planModelConfigMigration(data);
  const waiting = new Set(plan.createFor.map(String));
  const waitingDevices = data.devices.filter((d) => waiting.has(String(d.deviceModelId))).length;

  console.log(`Живых моделей: ${data.models.length}`);
  console.log(`  без конфигураций — создать пустую: ${plan.createFor.length}`);
  console.log(`  с двумя и больше — включить «Несколько конфигураций»: ${plan.multiOn.length}`);
  for (const id of plan.multiOn) console.log(`    ${id}`);
  console.log(`Устройств без конфигурации: ${data.devices.length}`);
  console.log(`  привязать к единственной конфигурации модели: ${plan.link.length}`);
  console.log(`  привязать после создания конфигурации модели: ${waitingDevices}`);

  if (!apply) {
    console.log("\nПоказ без записи. Повторите с --apply.");
    await mongoose.disconnect();
    return;
  }

  const missed = [];

  // Пустая конфигурация — только если у модели её всё ещё нет
  let created = 0;
  for (const modelId of plan.createFor) {
    const live = await DeviceConfiguration.countDocuments({ deviceModelId: modelId, deletedAt: null });
    if (live > 0) {
      missed.push(`  модель ${modelId}: конфигурация появилась после чтения`);
      continue;
    }
    await new DeviceConfiguration({ deviceModelId: modelId, values: [] }).save();
    created += 1;
  }

  let switched = 0;
  for (const modelId of plan.multiOn) {
    const result = await DeviceModel.updateOne(
      { _id: modelId, multiConfig: { $ne: true } },
      { $set: { multiConfig: true } },
    );
    if (result.matchedCount) switched += result.modifiedCount;
    else missed.push(`  модель ${modelId}: режим уже включён или модель изменилась`);
  }

  // Второй проход: у моделей из createFor теперь есть конфигурация
  const linkPlan = planModelConfigMigration(await load()).link;
  let linked = 0;
  for (const { deviceId, configurationId } of linkPlan) {
    const result = await ClientDevice.updateOne(
      { _id: deviceId, deletedAt: null, configurationId: null },
      { $set: { configurationId } },
    );
    if (result.matchedCount) linked += result.modifiedCount;
    else missed.push(`  устройство ${deviceId}: конфигурация появилась после чтения`);
  }

  console.log(
    `\nСоздано конфигураций: ${created}, режим включён у моделей: ${switched}, привязано устройств: ${linked}.`,
  );
  if (missed.length) {
    console.log("Не совпали со стражем (значения не тронуты):");
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
