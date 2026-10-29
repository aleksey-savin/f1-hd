/**
 * Сид системных атрибутов устройства (план
 * docs/superpowers/plans/2026-10-29-device-instance-attributes.md): «IP-адрес»,
 * «MAC-адрес» и «Операционная система» — атрибуты уровня «device», бывшие поля
 * карточки устройства. Находит по коду или имени, недостающие создаёт,
 * найденную на уровне модели ОС переводит на устройство (со значениями в
 * конфигурациях — останавливается, services/inventory/systemDeviceAttributes).
 *
 * Связывает их с типами, у экземпляров которых эти параметры есть. Тип ищется
 * по имени; не найден (переименован, удалён, другая база) — пропуск. Уже
 * связанное не трогается: группу и обязательность владелец ставит сам.
 */
const DeviceType = require("../../models/inventory/deviceType");
const {
  ensureSystemAttributes,
  ensureTypeLinks,
} = require("../../services/inventory/systemDeviceAttributes");

const TYPE_NAMES = [
  "Системный блок",
  "Ноутбук",
  "Моноблок",
  "Сервер",
  "Маршрутизатор",
  "Коммутатор",
  // Типы устройств MikroTik (seedMikrotikModels.js): синхронизация пишет им ОС и IP
  "Точка доступа",
  "Cloud Hosted Router",
];

const apply = async ({ log }) => {
  const ids = await ensureSystemAttributes({ log });
  for (const name of TYPE_NAMES) {
    const type = await DeviceType.findOne({ name }).select("_id").lean();
    if (!type) {
      log(`тип «${name}» не найден — пропуск`);
      continue;
    }
    await ensureTypeLinks(type._id, [ids.os, ids.ip, ids.mac]);
    log(`тип «${name}»: связки на месте`);
  }
};

module.exports = { apply, TYPE_NAMES };
