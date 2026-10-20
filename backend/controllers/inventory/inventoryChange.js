// Предложения ИИ-агента по инвентарю: ручки портала. Решение — services/inventory/changeDecisions (его же зовёт
// бот Telegram), вид — services/inventory/changeView. Здесь только HTTP: сессия, коды, разрешение созданного.
// Курсор пульса (X-Pulse-Cursor) ставит общий слой внутренних маршрутов до чтения данных (routes/index.js).
const mongoose = require("mongoose");

const { AppError } = require("../../middleware/errorHandling");
const { MESSAGES } = require("../../services/inventory/changeDecisions");
const { toView, canView, createdRefs } = require("../../services/inventory/changeView");
const { STATUS, isOpen } = require("../../services/inventory/changeSteps");

const COMMENT_MAX = 300;
const AWAITING_MAX = 100;
const CODE_STATUS = { not_yours: 403, no_right: 403, closed: 409, expired: 410, not_found: 404 };
const BAD_DECISION = "Некорректное решение";

const idOf = (v) => (v && typeof v === "object" && "_id" in v ? String(v._id) : v == null ? "" : String(v));

// Права — только из сессии, не из тела запроса
const viewerOf = (req) => ({
  userId: String(req.userId),
  canManageDevices: Boolean(req.auth?.can?.({ device: ["manage"] })),
  canManageCatalog: Boolean(req.auth?.can?.({ inventoryCatalog: ["manage"] })),
});

// Комментарий — одна строка до 300 знаков (как у Mikrotik); undefined — без комментария
function parseComment(value) {
  if (value === undefined || value === null || value === "") return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false };
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > COMMENT_MAX) return { ok: false };
  return { ok: true, value: text || undefined };
}

/**
 * createController({ decisions, repo, now, log })
 *   decisions: decide({ changeId, userId, decision, channel, comment }) -> { ok, change } | { ok:false, code, message }
 *   repo: findById(id), listAwaiting(userId), resolveCreated([{ model, id }]) -> Map("<model>:<id>" → { label, to? })
 */
function createController({ decisions, repo, now = () => new Date(), log }) {
  const validId = (id) => mongoose.isValidObjectId(id);
  const notFound = () => new AppError(MESSAGES.not_found, 404);
  const wrap = (label, fn) => async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      if (error instanceof AppError) return next(error);
      try { log?.log?.("error", `Inventory change: ${label} failed`, { error: error?.message }); } catch { /* журнал не критичен */ }
      next(new AppError(`Failed to ${label}`, 500, true, error));
    }
  };

  const viewOf = async (change, viewer) => {
    const refs = createdRefs(change);
    const created = refs.length ? await repo.resolveCreated(refs) : new Map();
    return toView(change, viewer, now(), { created });
  };

  // Чужому без прав предложения «нет»: тот же 404, что и для пропавшего, — иначе код выдал бы его существование
  const visible = async (id, viewer) => {
    if (!validId(id)) return null;
    const change = await repo.findById(id);
    return change && canView(change, viewer) ? change : null;
  };

  const getOne = wrap("fetch inventory change", async (req, res, next) => {
    const viewer = viewerOf(req);
    const change = await visible(req.params.id, viewer);
    if (!change) return next(notFound());
    res.status(200).json(await viewOf(change, viewer));
  });

  // Главная: свои открытые и не истёкшие. Базу спрашиваем грубо, остальное досчитываем здесь
  const awaitingMe = wrap("list awaiting inventory changes", async (req, res) => {
    const viewer = viewerOf(req);
    const at = now().getTime();
    const list = (await repo.listAwaiting(viewer.userId))
      .filter((change) =>
        idOf(change.requestedBy) === viewer.userId &&
        isOpen(change.status) &&
        // Без срока или с битой датой — истёкшее, как в сервисе решений
        at < (change.expiresAt ? new Date(change.expiresAt).getTime() : NaN))
      .slice(0, AWAITING_MAX);
    res.status(200).json(await Promise.all(list.map((change) => viewOf(change, viewer))));
  });

  const decide = wrap("decide inventory change", async (req, res, next) => {
    const { decision } = req.body || {};
    const comment = parseComment(req.body?.comment);
    if ((decision !== "approve" && decision !== "reject") || !comment.ok) return next(new AppError(BAD_DECISION, 400));
    const viewer = viewerOf(req);
    if (!(await visible(req.params.id, viewer))) return next(notFound());

    const result = await decisions.decide({
      changeId: req.params.id,
      userId: viewer.userId,
      decision,
      channel: "portal",
      comment: comment.value,
    });
    if (!result.ok) return next(new AppError(result.message || MESSAGES[result.code], CODE_STATUS[result.code] || 400));

    // Утверждение применяется сразу: перечитанный документ несёт итог операций
    const change = (await repo.findById(req.params.id)) || result.change;
    res.status(200).json(await viewOf(change, viewer));
  });

  return { getOne, awaitingMe, decide };
}

// Боевая сборка: единственное место с моделями. Не покрыта тестами (нужна база).
const POPULATE = [
  { path: "requestedBy", select: "firstName lastName" },
  { path: "timeline.user", select: "firstName lastName" },
];

// Адреса страниц фронтенда по модели; конфигурация ведёт на страницу своей модели
const PATHS = {
  ClientDevice: (id) => `/inventory/client-devices/${id}`,
  DeviceModel: (id) => `/inventory/device-models/${id}`,
  DeviceType: (id) => `/inventory/device-types/${id}`,
  Vendor: (id) => `/inventory/vendors/${id}`,
  DeviceBuild: (id) => `/inventory/device-builds/${id}`,
  Supplier: (id) => `/inventory/suppliers/${id}`,
};

function realDeps() {
  const InventoryChange = require("../../models/inventory/inventoryChange");
  const models = {
    ClientDevice: require("../../models/inventory/clientDevice"),
    DeviceModel: require("../../models/inventory/deviceModel"),
    DeviceConfiguration: require("../../models/inventory/deviceConfiguration"),
    DeviceType: require("../../models/inventory/deviceType"),
    DeviceAttribute: require("../../models/inventory/deviceAttribute"),
    AttributeGroup: require("../../models/inventory/attributeGroup"),
    Vendor: require("../../models/inventory/vendor"),
    Supplier: require("../../models/inventory/supplier"),
    DeviceBuild: require("../../models/inventory/deviceBuild"),
  };
  const { liveInventoryDecisions } = require("../../services/inventory/changeDecisions");

  // Один запрос на модель; удалённое (и мягко удалённое) пропускается
  const load = (model, ids, select) =>
    ids.length ? models[model].find({ _id: { $in: ids }, deletedAt: null }).select(select).lean() : [];

  async function resolveCreated(refs) {
    const byModel = new Map();
    for (const { model, id } of refs) {
      if (!models[model] || !mongoose.isValidObjectId(id)) continue;
      if (!byModel.has(model)) byModel.set(model, []);
      byModel.get(model).push(id);
    }
    const ids = (model) => byModel.get(model) || [];
    const out = new Map();
    const put = (model, doc, label, to) => out.set(`${model}:${String(doc._id)}`, { label, ...(to ? { to } : {}) });

    // Конфигурации — первыми: их модели читаются вместе с созданными моделями, одним запросом
    const configs = await load("DeviceConfiguration", ids("DeviceConfiguration"), "name deviceModelId");
    const modelIds = [...new Set([...ids("DeviceModel"), ...configs.map((c) => String(c.deviceModelId))])];
    const deviceModels = await load("DeviceModel", modelIds, "name");
    const modelById = new Map(deviceModels.map((m) => [String(m._id), m]));
    const created = new Set(ids("DeviceModel").map(String));

    for (const m of deviceModels) if (created.has(String(m._id))) put("DeviceModel", m, m.name, PATHS.DeviceModel(m._id));
    for (const c of configs) {
      const parent = modelById.get(String(c.deviceModelId));
      // Подпись как на макете: «Модель «конфигурация»»; без модели — только имя и без ссылки
      put("DeviceConfiguration", c, parent ? `${parent.name} «${c.name}»` : c.name, parent ? PATHS.DeviceModel(parent._id) : null);
    }
    for (const d of await load("ClientDevice", ids("ClientDevice"), "inventoryNumber serialNumber")) {
      put("ClientDevice", d, d.inventoryNumber || d.serialNumber || "без номера", PATHS.ClientDevice(d._id));
    }
    // У группы своей страницы нет (PATHS): подпись без ссылки
    for (const model of ["DeviceType", "DeviceAttribute", "AttributeGroup", "Vendor", "Supplier", "DeviceBuild"]) {
      for (const doc of await load(model, ids(model), "name")) put(model, doc, doc.name, PATHS[model]?.(doc._id));
    }
    return out;
  }

  return {
    decisions: liveInventoryDecisions(),
    log: require("../../utils/logger"),
    repo: {
      findById(id) {
        return InventoryChange.findById(id).populate(POPULATE).lean();
      },
      listAwaiting(userId) {
        return InventoryChange.find({ requestedBy: userId, status: STATUS.awaitingRequester, expiresAt: { $gt: new Date() } })
          .sort({ createdAt: -1 })
          .limit(AWAITING_MAX)
          .populate(POPULATE)
          .lean();
      },
      resolveCreated,
    },
  };
}

// Зависимости собираются при первом обращении: модуль можно подключить без базы и логгера
let built;
const lazy = (name) => (req, res, next) => {
  built ||= createController(realDeps());
  return built[name](req, res, next);
};

module.exports = {
  createController,
  getOne: lazy("getOne"),
  awaitingMe: lazy("awaitingMe"),
  decide: lazy("decide"),
};
