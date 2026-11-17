const mongoose = require("mongoose");
const ClientDevice = require("../../models/inventory/clientDevice");
const Location = require("../../models/inventory/location");
const { deviceVisibleTo } = require("../deviceScope");
const { planMoveDevice } = require("./deviceOps");
const { AppError } = require("../../middleware/errorHandling");

const idOf = (value) => String(value?._id ?? value ?? "");
const label = (device) =>
  device.inventoryNumber || device.hostname || "Устройство";
const parseIds = (ids) => {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 10000 ||
    ids.some((id) => typeof id !== "string" || !mongoose.isValidObjectId(id))
  ) {
    throw new AppError("Выберите от 1 до 10000 устройств", 400);
  }
  return [...new Set(ids)];
};

async function previewMove(rawIds, viewer) {
  const ids = parseIds(rawIds);
  const devices = await ClientDevice.find({
    _id: { $in: ids },
    deletedAt: null,
  });
  if (
    devices.length !== ids.length ||
    devices.some((d) => !deviceVisibleTo(viewer, d))
  ) {
    throw new AppError("Выбранные устройства недоступны. Обновите список", 404);
  }
  const component = devices.find((d) => d.parentDeviceId);
  if (component)
    return {
      reason: `${label(component)} входит в сборку. Выберите устройство целиком`,
      locations: [],
    };
  const parts = await ClientDevice.find({
    parentDeviceId: { $in: ids },
    deletedAt: null,
  });
  if (parts.some((d) => !deviceVisibleTo(viewer, d))) {
    return {
      reason: "В выбранной сборке есть недоступные комплектующие",
      locations: [],
    };
  }
  const companies = [
    ...new Set([...devices, ...parts].map((d) => idOf(d.companyId))),
  ];
  const locations = await Location.find(
    companies.length === 1
      ? { $or: [{ company: companies[0] }, { isPublic: true }] }
      : { isPublic: true },
  ).populate("company", "alias fullTitle");
  const options = await Promise.all(
    locations.map(async (location) => ({
      value: idOf(location),
      label: (await location.fullPath) || location.name,
      hint: location.company?.alias || location.company?.fullTitle,
    })),
  );
  return {
    reason: options.length
      ? null
      : "Нет расположений, доступных для всех выбранных устройств",
    locations: options.sort((a, b) => a.label.localeCompare(b.label, "ru")),
  };
}

async function moveDevices(rawIds, locationId, { viewer, actorId }) {
  const ids = parseIds(rawIds);
  if (typeof locationId !== "string" || !mongoose.isValidObjectId(locationId)) {
    throw new AppError("Выберите расположение", 400);
  }
  const preview = await previewMove(ids, viewer);
  if (preview.reason) throw new AppError(preview.reason, 409);
  if (!preview.locations.some((location) => location.value === locationId)) {
    throw new AppError("Расположение недоступно для выбранных устройств", 409);
  }
  // Проверяем весь набор до записи. Планы включают все живые детали сборок.
  const plans = [];
  for (const id of ids) {
    const plan = await planMoveDevice(id, locationId, { actorId });
    if (!plan.ok) throw new AppError(plan.message, plan.status);
    if (plan.writes.some((device) => !deviceVisibleTo(viewer, device))) {
      throw new AppError("Состав сборки изменился. Обновите выбор", 409);
    }
    plans.push(plan);
  }
  const completedIds = [];
  let changedRecords = 0;
  try {
    for (const plan of plans) {
      for (const device of plan.writes) {
        await device.save();
        changedRecords += 1;
      }
      completedIds.push(idOf(plan.device));
    }
  } catch {
    return {
      error: true,
      completedIds,
      changedRecords,
      pendingIds: ids.filter((id) => !completedIds.includes(id)),
      message: `Перемещено устройств целиком: ${completedIds.length} из ${ids.length}. Сохранено записей с комплектующими: ${changedRecords}. Остальные могли сохраниться частично. Обновите список и повторите перенос.`,
    };
  }
  return {
    completedIds,
    message: `Перемещено устройств: ${completedIds.length}`,
  };
}
module.exports = { previewMove, moveDevices, parseIds };
