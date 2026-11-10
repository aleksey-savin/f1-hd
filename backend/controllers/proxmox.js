const { Connection, Resource } = require("../models/proxmox");
const Preferences = require("../models/preferences");
const { fail } = require("../services/proxmox/policy");
const read = require("../services/proxmox/view");
const core = require("../services/proxmox/core");
const requireCan = (req, action) => {
  if (req.auth.isEndUser || !req.auth.can({ proxmox: [action] }))
    fail("Недостаточно прав", 403);
};
const actor = (req) => req.auth.userId || req.userId;
const getResource = async (id) => {
  const r = await Resource.findById(read.validId(id));
  if (!r) fail("Ресурс не найден", 404);
  return r;
};
const validateJump = async (req, endpoints) => {
  for (const ep of endpoints || [])
    if (ep.transport === "mikrotik") {
      if (!req.auth.can({ mikrotik: ["read"] }))
        fail("Нет доступа к устройствам MikroTik", 403);
      read.validId(ep.mikrotikRecordId);
      const p = await Preferences.findOne({}).lean();
      if (!p?.modules?.mikrotik?.isActive)
        fail("Модуль MikroTik выключен", 409);
      const m = await require("../models/mikrotik").findById(
        ep.mikrotikRecordId,
      );
      if (!m || !m.monitoringEnabled || m.jumpRecordId)
        fail("Транзитное устройство недоступно", 409);
    }
};
exports.list = async (req, res) =>
  res.json(await read.list(req.params.kind, req.query, { prefs: await Preferences.findOne({}).lean() }));
exports.detail = async (req, res) =>
  res.json(await read.detail(req.params.kind, req.params.id, { prefs: await Preferences.findOne({}).lean() }));
exports.verify = async (req, res) => {
  const current = req.body.connectionId
    ? await Connection.findById(read.validId(req.body.connectionId)).select(
        "+tokenSecret",
      )
    : null;
  if (req.body.connectionId && !current) fail("Подключение не найдено", 404);
  await validateJump(req, req.body.endpoints || current?.endpoints);
  const prepared = await core.prepare(req.body, current, {
    verificationOnly: true,
  });
  res.json({ verification: await core.verify(prepared) });
};
exports.saveConnection = async (req, res) => {
  const current = req.params.id
    ? await Connection.findById(read.validId(req.params.id)).select(
        "+tokenSecret",
      )
    : null;
  if (req.params.id && !current) fail("Подключение не найдено", 404);
  await validateJump(req, req.body.endpoints || current?.endpoints);
  const data = await core.prepare(req.body, current);
  const verification = await core.verify(data);
  const item = current
    ? await Connection.findByIdAndUpdate(
        current._id,
        {
          $set: {
            ...data,
            version: verification.version,
            clusterIdentity: verification.clusterIdentity,
            ...(verification.isCluster !== undefined
              ? {
                  isCluster: verification.isCluster,
                  clusterName: verification.clusterName,
                }
              : {}),
          },
        },
        { new: true },
      )
    : await Connection.create({
        ...data,
        version: verification.version,
        clusterIdentity: verification.clusterIdentity,
        ...(verification.isCluster !== undefined
          ? {
              isCluster: verification.isCluster,
              clusterName: verification.clusterName,
            }
          : {}),
      });
  await core.event(
    item,
    "connectionSaved",
    "Подключение проверено и сохранено",
    actor(req),
  );
  res.status(current ? 200 : 201).json({ item: read.view(item), verification });
};
exports.connectionMonitoring = async (req, res) => {
  const c = await Connection.findById(read.validId(req.params.id));
  if (!c) fail("Подключение не найдено", 404);
  if (typeof req.body.monitoringEnabled !== "boolean")
    fail("Укажите состояние мониторинга");
  c.monitoringEnabled = req.body.monitoringEnabled;
  await c.save();
  await core.event(
    c,
    "monitoringChanged",
    c.monitoringEnabled ? "Мониторинг включён" : "Мониторинг выключен",
    actor(req),
  );
  res.json({ item: read.view(c) });
};
exports.archive = async (req, res) => {
  const c = await Connection.findById(read.validId(req.params.id));
  if (!c) fail("Подключение не найдено", 404);
  if (await require("../services/proxmox/operationStore").hasActive(c._id))
    fail("Сначала завершите или проверьте активные операции", 409);
  await Connection.updateOne(
    { _id: c._id },
    { $set: { archived: true, monitoringEnabled: false } },
  );
  await Resource.updateMany(
    { connectionId: c._id },
    { $set: { archived: true } },
  );
  await core.event(c, "archived", "Подключение архивировано", actor(req));
  res.json({ message: "Подключение архивировано" });
};
exports.company = async (req, res) => {
  const ids = req.body.ids || [req.params.id];
  if (!Array.isArray(ids) || !ids.length || ids.length > 100)
    fail("Выберите до 100 ресурсов");
  ids.forEach(read.validId);
  const companyId = req.body.companyId
    ? await core.activeCompany(read.validId(req.body.companyId))
    : null;
  const kind = req.params.kind === "nodes" ? "node" : "guest";
  if (kind === "node" && !companyId) fail("Узел должен иметь владельца");
  const resources = await Resource.find({ _id: { $in: ids }, kind });
  if (resources.length !== ids.length) fail("Ресурс не найден", 404);
  for (const r of resources)
    if (r.clientDeviceId && String(r.companyId) !== String(companyId))
      fail("Сначала отвяжите карточку инвентаря", 409);
  for (const r of resources) {
    const old = String(r.companyId || "");
    r.companyId = companyId;
    await r.save();
    await core.event(
      r,
      "companyChanged",
      `Привязка компании изменена (${old || "не назначена"} → ${companyId || "не назначена"})`,
      actor(req),
    );
  }
  res.json({ items: resources.map(read.view) });
};
exports.guestMonitoring = async (req, res) => {
  const r = await getResource(req.params.id);
  if (r.kind !== "guest" || typeof req.body.expectedRunning !== "boolean")
    fail("Укажите политику мониторинга ВМ");
  r.expectedRunning = req.body.expectedRunning;
  await r.save();
  await core.event(
    r,
    "policyChanged",
    "Изменена политика контроля ВМ",
    actor(req),
  );
  res.json({ item: read.view(r) });
};
exports.resourceMonitoring = async (req, res) => {
  requireCan(req, "read");
  requireCan(req, "manage");
  const resource = await getResource(req.params.id);
  if (!["guest", "node"].includes(resource.kind) || resource.archived)
    fail("Выберите действующую ВМ или узел", 422);
  if (typeof req.body.monitoringEnabled !== "boolean")
    fail("Укажите состояние мониторинга");
  resource.monitoringEnabled = req.body.monitoringEnabled;
  resource.failedPolls = 0;
  resource.failureAt = undefined;
  resource.thresholdSince = {};
  await resource.save();
  if (!resource.monitoringEnabled)
    await require("../services/proxmox/monitor").recoverResource(resource);
  const connection = await Connection.findById(resource.connectionId);
  if (connection)
    await require("../services/proxmox/availability").observe(
      resource,
      connection,
    );
  await core.event(
    resource,
    "monitoringChanged",
    resource.monitoringEnabled ? "Мониторинг включён" : "Мониторинг выключен",
    actor(req),
  );
  res.json({ item: read.view(resource) });
};
exports.guestAgent = async (req, res) => {
  requireCan(req, "read");
  requireCan(req, "manage");
  const resource = await getResource(req.params.id);
  const connection = await Connection.findById(resource.connectionId).select(
    "+tokenSecret",
  );
  const patch = await require("../services/proxmox/guest-agent").updateSettings(
    resource,
    connection,
    req.body,
  );
  Object.assign(resource, patch);
  await resource.save();
  await core.event(
    resource,
    "guestAgentChanged",
    "Изменены параметры QEMU Guest Agent",
    actor(req),
  );
  res.json({ item: read.view(resource) });
};
exports.guestSecurity = async (req, res) => {
  const resource = await getResource(req.params.id);
  if (resource.kind !== "guest") fail("Выберите гостевую ОС", 422);
  const { GuestSecurity } = require("../models/proxmox");
  res.json({
    report: require("../services/proxmox/guest-security").publicView(
      await GuestSecurity.findOne({ resourceId: resource._id }).lean(),
      await Preferences.findOne({}).lean(),
    ),
  });
};
exports.checkGuestSecurity = async (req, res) => {
  requireCan(req, "manage");
  const resource = await getResource(req.params.id);
  const report = await require("../services/proxmox/guest-security").enqueue(
    resource,
  );
  await core.event(
    resource,
    "guestSecurityCheck",
    "Запрошена проверка CVE гостевой ОС",
    actor(req),
  );
  res.status(202).json({ report: require("../services/proxmox/cve-policy").applyCvePolicy(report, await Preferences.findOne({}).lean()) });
};
exports.operation = async (req, res) => {
  requireCan(req, req.body.operation === "backup" ? "backup" : "power");
  const resource = await getResource(req.params.id);
  const operation = await require("../services/proxmox/operations").enqueue(
    resource,
    req.body,
    actor(req),
  );
  core.bump();
  res.status(202).json({
    operation: require("../services/proxmox/operationStore").publicView(
      operation,
    ),
  });
};
exports.operationHistory = async (req, res) => {
  const resource = await getResource(req.params.id);
  if (resource.kind !== "guest") fail("Журнал операций доступен для ВМ", 422);
  res.json(
    await require("../services/proxmox/operationStore").history(
      resource._id,
      req.query.cursor,
    ),
  );
};
exports.reconcile = async (req, res) => {
  const resource = await getResource(req.params.id),
    store = require("../services/proxmox/operationStore");
  const operation = await store.findOne({
    _id: read.validId(req.params.operationId),
    resourceId: resource._id,
  });
  if (!operation) fail("Операция не найдена", 404);
  requireCan(req, operation.operation === "backup" ? "backup" : "power");
  await require("../services/proxmox/operations").reconcile(
    operation,
    actor(req),
    req.body,
  );
  core.bump();
  res.json({
    message: "Проверка зафиксирована",
    operation: store.publicView(
      await store.findOne({ _id: operation._id, resourceId: resource._id }),
    ),
  });
};
exports.cancelOperation = async (req, res) => {
  const resource = await getResource(req.params.id),
    store = require("../services/proxmox/operationStore");
  const operation = await store.findOne({
    _id: read.validId(req.params.operationId),
    resourceId: resource._id,
  });
  if (!operation) fail("Операция не найдена", 404);
  requireCan(req, operation.operation === "backup" ? "backup" : "power");
  await require("../services/proxmox/operations").cancel(
    operation,
    actor(req),
    req.body,
  );
  core.bump();
  res.json({
    message: "Запрос отмены обработан",
    operation: store.publicView(
      await store.findOne({ _id: operation._id, resourceId: resource._id }),
    ),
  });
};
exports.metrics = async (req, res) =>
  res.json(await read.metrics(req.params.id, req.query.timeframe));
exports.events = async (req, res) =>
  res.json(await read.events(req.params.id, req.query));
exports.availability = async (req, res) =>
  res.json(await read.availability(req.params.id, req.query.days || 30));
exports.nodeSecurity = async (req, res) => {
  const resource = await getResource(req.params.id);
  if (resource.kind !== "node") fail("Выберите узел Proxmox", 422);
  res.json({
    report: await require("../services/proxmox/node-security").getReport(
      resource._id,
      await Preferences.findOne({}).lean(),
    ),
  });
};
exports.checkNodeSecurity = async (req, res) => {
  requireCan(req, "manage");
  const resource = await getResource(req.params.id);
  const report = await require("../services/proxmox/node-security").refresh(
    resource,
  );
  await core.event(
    resource,
    "nodeSecurityCheck",
    "Запрошена проверка CVE и обновлений узла",
    actor(req),
  );
  res.status(202).json({ report: require("../services/proxmox/cve-policy").applyCvePolicy(report, await Preferences.findOne({}).lean()) });
};
exports.maintenance = async (req, res) => {
  const r = await getResource(req.params.id);
  let value = null;
  if (req.body.until) {
    const from = new Date(req.body.from || Date.now()),
      until = new Date(req.body.until);
    if (
      !Number.isFinite(+from) ||
      !Number.isFinite(+until) ||
      until <= from ||
      until <= new Date()
    )
      fail("Укажите корректный интервал");
    const reason = String(req.body.reason || "").trim();
    if (!reason || reason.length > 500) fail("Укажите причину обслуживания");
    value = { from, until, reason };
  }
  r.maintenance = value;
  await r.save();
  await core.event(
    r,
    "maintenance",
    value ? "Запланировано обслуживание" : "Обслуживание отменено",
    actor(req),
  );
  res.json({ item: read.view(r) });
};
exports.inventory = async (req, res) => {
  if (!req.auth.can({ device: ["manage"] }))
    fail("Нет права управления техникой", 403);
  const p = await Preferences.findOne({}).lean();
  if (!p?.modules?.inventory?.isActive) fail("Модуль инвентаря выключен", 409);
  const r = await getResource(req.params.id);
  if (!["node", "guest"].includes(r.kind))
    fail("Хранилище нельзя связать с карточкой");
  if (req.body.clientDeviceId) {
    const card = await require("../models/inventory/clientDevice").findById(
      read.validId(req.body.clientDeviceId),
    );
    if (!card || String(card.companyId) !== String(r.companyId))
      fail("Компания карточки должна совпадать с компанией ресурса");
    r.clientDeviceId = card._id;
  } else r.clientDeviceId = undefined;
  try {
    await r.save();
  } catch (e) {
    if (e.code === 11000) fail("Карточка уже связана с другим ресурсом", 409);
    throw e;
  }
  await core.event(
    r,
    "inventoryLinked",
    "Изменена связь с инвентарём",
    actor(req),
  );
  res.json({ item: read.view(r) });
};
exports.companyResources = async (req, res) => {
  const rows = await Resource.find({
    companyId: read.validId(req.params.id),
    kind: "guest",
    archived: false,
  })
    .populate("companyId", "alias fullTitle")
    .lean();
  const totals = {
    count: rows.length,
    cpu: 0,
    memory: 0,
    disk: 0,
    unknownDisk: 0,
  };
  for (const r of rows) {
    for (const k of ["cpu", "memory", "disk"])
      totals[k] += r.resources?.[k] || 0;
    if (r.resources?.disk == null) totals.unknownDisk++;
  }
  res.json({ items: rows.map(read.view), totals });
};
exports.createDiscovery = async (req, res) => {
  await validateJump(req, [req.body]);
  const session = await require("../services/proxmox/discovery").start(
    req.body,
    actor(req),
  );
  res.status(202).json({ session });
};
exports.discovery = async (req, res) =>
  res.json({
    session: await require("../services/proxmox/discovery").get(
      req.params.id,
      actor(req),
    ),
  });
exports.cancelDiscovery = async (req, res) =>
  res.json({
    session: await require("../services/proxmox/discovery").cancel(
      req.params.id,
      actor(req),
    ),
  });
exports.closeDiscovery = (req, res) => {
  require("../services/proxmox/discovery").close(req.params.id, actor(req));
  res.sendStatus(204);
};
exports.networks = async (req, res) => {
  await validateJump(req, [
    { transport: "mikrotik", mikrotikRecordId: req.query.mikrotikRecordId },
  ]);
  res.json(
    await require("../services/proxmox/discovery").networks(
      req.query.mikrotikRecordId,
    ),
  );
};
exports.options = async (req, res) => {
  const companies = await require("../models/company")
    .find({ isActive: { $ne: false } })
    .select("alias fullTitle")
    .lean();
  const map = (r) => ({
    id: String(r._id),
    name:
      r.name ||
      r.alias ||
      r.fullTitle ||
      r.hostname ||
      r.inventoryNumber ||
      r.fullName ||
      r.email ||
      r.title ||
      String(r._id),
    companyId: r.companyId ? String(r.companyId) : null,
  });
  const p = await Preferences.findOne({}).lean();
  const mikrotik =
    p?.modules?.mikrotik?.isActive && req.auth.can({ mikrotik: ["read"] })
      ? await require("../models/mikrotik")
          .find({ monitoringEnabled: true, jumpRecordId: { $exists: false } })
          .select("name label")
          .lean()
      : [];
  const inventory =
    p?.modules?.inventory?.isActive && req.auth.can({ device: ["manage"] })
      ? await require("../models/inventory/clientDevice")
          .find({})
          .select("hostname inventoryNumber companyId")
          .limit(1000)
          .lean()
      : [];
  const applicants = await require("../models/user")
    .find({ isServiceAccount: true })
    .select("firstName lastName email")
    .lean();
  const categories = await require("../models/ticketCategory")
    .find({})
    .select("name title")
    .lean();
  res.json({
    companies: companies.map(map),
    mikrotik: mikrotik.map(map),
    inventory: inventory.map(map),
    applicants: applicants.map(map),
    categories: categories.map(map),
    storages: (
      await Resource.find({ kind: "storage", archived: false })
        .select("externalId name connectionId nodeName")
        .lean()
    ).map((r) => ({
      id: r.externalId.split("/").pop(),
      name: r.name,
      connectionId: String(r.connectionId),
      nodeName: r.nodeName,
    })),
  });
};
exports.settings = async (req, res) => {
  const p = await Preferences.findOne({}).lean();
  res.json({
    settings: require('../services/proxmox/exposure/network-links').publicSettings(p?.proxmox, req.auth.can) || {
      cpuThreshold: 90,
      memoryThreshold: 90,
      storageWarning: 85,
      storageCritical: 95,
      thresholdMinutes: 5,
      autoTickets: false,
    },
  });
};
exports.saveSettings = async (req, res) => {
  const current = await Preferences.findOne({}).select("proxmox").lean();
  const { data, changes } =
    await require("../services/proxmox/settings").validateSettings(
      req.body,
      current?.proxmox,
      { can: req.auth.can },
    );
  if (Object.keys(changes).length)
    await Preferences.updateOne(
      {},
      {
        $set: Object.fromEntries(
          Object.entries(changes).map(([key, value]) => [
            `proxmox.${key}`,
            value,
          ]),
        ),
      },
    );
  if (Object.hasOwn(changes, 'networkLinks')) {
    await require('../services/proxmox/exposure/store').invalidateResources({},'networkLinksChanged');
    await core.event({connectionId:null},'networkLinksChanged','Сохранены связи сетей Proxmox с MikroTik',actor(req));
  }
  core.bump();
  res.json({ settings: require('../services/proxmox/exposure/network-links').publicSettings(data,req.auth.can) });
};

exports.companies = async (req, res) => {
  const Company = require("../models/company");
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = 30;
  const filter = { isActive: { $ne: false } };
  const [rows, total] = await Promise.all([
    Company.find(filter)
      .sort({ alias: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select("alias fullTitle")
      .lean(),
    Company.countDocuments(filter),
  ]);
  res.json({
    items: rows.map((r) => ({
      ...r,
      id: String(r._id),
      name: r.alias || r.fullTitle,
    })),
    total,
    page,
    pageSize,
  });
};
exports.companyDetail = async (req, res) => {
  const item = await require("../models/company")
    .findById(read.validId(req.params.id))
    .select("alias fullTitle")
    .lean();
  if (!item) fail("Компания не найдена", 404);
  const guests = await Resource.find({
    companyId: item._id,
    kind: "guest",
    archived: false,
  })
    .populate("companyId", "alias fullTitle")
    .lean();
  const totals = {
    count: guests.length,
    cpu: 0,
    memory: 0,
    disk: 0,
    unknownDisk: guests.filter((r) => r.resources?.disk == null).length,
  };
  for (const r of guests)
    for (const k of ["cpu", "memory", "disk"])
      totals[k] += r.resources?.[k] || 0;
  res.json({
    item: {
      ...item,
      id: String(item._id),
      name: item.alias || item.fullTitle,
      totals,
    },
    related: { guests: guests.map(read.view) },
  });
};

exports.connectionMaintenance = async (req, res) => {
  const item = await Connection.findById(read.validId(req.params.id));
  if (!item) fail("Подключение не найдено", 404);
  let maintenance = null;
  if (req.body.until) {
    const from = new Date(req.body.from || Date.now()),
      until = new Date(req.body.until);
    const reason = String(req.body.reason || "").trim();
    if (
      !Number.isFinite(+from) ||
      !Number.isFinite(+until) ||
      until <= from ||
      !reason ||
      reason.length > 500
    )
      fail("Укажите корректный интервал и причину");
    maintenance = { from, until, reason };
  }
  item.maintenance = maintenance;
  await item.save();
  await core.event(
    item,
    "maintenance",
    "Изменено обслуживание подключения",
    actor(req),
  );
  res.json({ item: read.view(item) });
};
