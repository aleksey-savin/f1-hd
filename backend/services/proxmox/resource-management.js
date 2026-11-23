const { Connection, Resource } = require("../../models/proxmox");
const Preferences = require("../../models/preferences");
const { fail } = require("./policy");
const read = require("./view");
const core = require("./core");
const companyEvents = require("./company-events");

const getResource = async (id) => {
  const r = await Resource.findById(read.validId(id));
  if (!r) fail("Ресурс не найден", 404);
  return r;
};

const setCompany = async (ids, kind, requestedCompany, actor) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10000)
    fail("Выберите до 10000 ресурсов");
  ids.forEach(read.validId);
  const companyId = requestedCompany
    ? await core.activeCompany(read.validId(requestedCompany))
    : null;
  if (kind === "node" && !companyId) fail("Узел должен иметь владельца");
  const resources = await Resource.find({ _id: { $in: ids }, kind, archived: false });
  if (resources.length !== ids.length) fail("Ресурс не найден", 404);
  for (const r of resources)
    if (r.kind === 'node' && r.clientDeviceId && String(r.companyId) !== String(companyId))
      fail("Сначала отвяжите карточку инвентаря", 409);
  const names = await companyEvents.namesFor([...resources.map(r => r.companyId), companyId]);
  const completedIds = [];
  try {
    for (const r of resources) {
      const companyChange = { from: companyEvents.snapshot(r.companyId, names), to: companyEvents.snapshot(companyId, names) };
      r.$where = { companyId: r.companyId ?? null, clientDeviceId: r.clientDeviceId ?? null, archived: false };
      r.companyId = companyId;
      await r.save();
      completedIds.push(String(r._id));
      await core.event(
        r,
        "companyChanged",
        companyEvents.message(companyChange),
        actor.userId,
        { companyChange, mcpKeyId: actor.mcpKeyId },
      );
    }
  } catch {
    return { error: true, completedIds,
      message: `Компания сохранена для ${completedIds.length} из ${resources.length} ресурсов. Сбой записи или журнала; обновите список перед повтором.`,
    };
  }
  return { resources, completedIds };
};

const setMonitoring = async (id, monitoringEnabled, actor) => {
  const resource = await getResource(id);
  if (!["guest", "node"].includes(resource.kind) || resource.archived)
    fail("Выберите действующую ВМ или узел", 422);
  if (typeof monitoringEnabled !== "boolean")
    fail("Укажите состояние мониторинга");
  resource.monitoringEnabled = monitoringEnabled;
  resource.failedPolls = 0;
  resource.failureAt = undefined;
  resource.thresholdSince = {};
  await resource.save();
  if (!resource.monitoringEnabled)
    await require("./monitor").recoverResource(resource);
  const connection = await Connection.findById(resource.connectionId);
  if (connection)
    await require("./availability").observe(
      resource,
      connection,
    );
  await core.event(
    resource,
    "monitoringChanged",
    resource.monitoringEnabled ? "Мониторинг включён" : "Мониторинг выключен",
    actor.userId,
    { mcpKeyId: actor.mcpKeyId },
  );
  return resource;
};

const setMaintenance = async (id, window, actor) => {
  const r = await getResource(id);
  let value = null;
  if (window?.until) {
    const from = new Date(window.from || Date.now()),
      until = new Date(window.until);
    if (
      !Number.isFinite(+from) ||
      !Number.isFinite(+until) ||
      until <= from ||
      until <= new Date()
    )
      fail("Укажите корректный интервал");
    const reason = String(window.reason || "").trim();
    if (!reason || reason.length > 500) fail("Укажите причину обслуживания");
    value = { from, until, reason };
  }
  r.maintenance = value;
  await r.save();
  await core.event(
    r,
    "maintenance",
    value ? "Запланировано обслуживание" : "Обслуживание отменено",
    actor.userId,
    { mcpKeyId: actor.mcpKeyId },
  );
  return r;
};

const setInventoryLink = async (id, clientDeviceId, actor) => {
  if (!actor.can({ device: ["manage"] }))
    fail("Нет права управления техникой", 403);
  const p = await Preferences.findOne({}).lean();
  if (!p?.modules?.inventory?.isActive) fail("Модуль инвентаря выключен", 409);
  const r = await getResource(id);
  if (r.kind !== 'node')
    fail('С карточкой инвентаря можно связать только узел Proxmox', 422);
  r.$where = { companyId: r.companyId ?? null, clientDeviceId: r.clientDeviceId ?? null };
  if (clientDeviceId) {
    const card = await require("../../models/inventory/clientDevice").findById(
      read.validId(clientDeviceId),
    );
    if (!r.companyId || !card?.companyId || String(card.companyId) !== String(r.companyId))
      fail("Компания карточки должна совпадать с компанией ресурса");
    r.clientDeviceId = card._id;
  } else r.clientDeviceId = undefined;
  try {
    await r.save();
  } catch (e) {
    if (e.name === "DocumentNotFoundError") fail("Ресурс изменился. Обновите карточку", 409);
    if (e.code === 11000) fail("Карточка уже связана с другим ресурсом", 409);
    throw e;
  }
  await core.event(
    r,
    "inventoryLinked",
    "Изменена связь с инвентарём",
    actor.userId,
    { mcpKeyId: actor.mcpKeyId },
  );
  return r;
};

module.exports = { getResource, setCompany, setMonitoring, setMaintenance, setInventoryLink };
