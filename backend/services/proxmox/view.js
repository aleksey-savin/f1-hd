const { Connection, Resource, Event } = require("../../models/proxmox");
const mongoose = require("mongoose");
const { fail } = require("./policy");
const {
  monitoringState,
  applyMonitoringFilters,
} = require("./monitoring-query");
const id = (v) => (v ? String(v._id || v) : null);
const company = (v) =>
  v ? { id: id(v), name: v.alias || v.fullTitle || "" } : null;
const view = (doc) => {
  const r = doc.toObject ? doc.toObject() : doc;
  const out = { ...r, id: id(r) };
  delete out.tokenSecret;
  delete out.__v;
  delete out.addresses;
  delete out.leaseUntil;
  delete out.monitoringIssues;
  delete out.operationData;
  delete out.guestNetwork;
  delete out.guestIncarnation;
  delete out.exposure;
  delete out.exposureGeneration;
  delete out.taskId;
  delete out.incidentId;
  out.company = company(r.companyId);
  out.companyId = id(r.companyId);
  if (r.connectionId) {
    out.connection = {
      id: id(r.connectionId),
      name: r.connectionId.name || "",
      monitoringEnabled: r.connectionId.monitoringEnabled,
    };
    out.monitoringPausedByConnection =
      r.connectionId.monitoringEnabled === false;
    out.connectionId = id(r.connectionId);
  }
  if (r.resourceId) {
    out.resource = {
      id: id(r.resourceId),
      name: r.resourceId.name || "",
      kind: r.resourceId.kind,
      vmid: r.resourceId.vmid,
      nodeName: r.resourceId.nodeName,
    };
    out.resourceId = id(r.resourceId);
  }
  if (r.tokenId) out.hasToken = true;
  if (r.clientDeviceId) {
    out.clientDevice = {
      id: id(r.clientDeviceId),
      name: r.clientDeviceId.hostname || r.clientDeviceId.inventoryNumber || "",
    };
    out.clientDeviceId = id(r.clientDeviceId);
  }
  if (r.kind === "node") {
    out.isCluster =
      typeof r.connectionId?.isCluster === "boolean"
        ? r.connectionId.isCluster
        : null;
    out.cluster =
      out.isCluster === true
        ? { id: id(r.connectionId), name: r.connectionId.clusterName || "" }
        : null;
  }
  if (r.kind) {
    out.monitoringState = monitoringState(r);
    out.freshness =
      !r.lastError &&
      r.lastCheckedAt &&
      Date.now() - new Date(r.lastCheckedAt).getTime() < 180000
        ? "fresh"
        : "stale";
    out.node = { name: r.nodeName };
  }
  return out;
};
const modelFor = (kind) =>
  ({
    connections: Connection,
    nodes: Resource,
    guests: Resource,
    storages: Resource,
  })[kind] || fail("Неизвестный раздел", 404);
const kindFilter = (kind) =>
  ({ nodes: "node", guests: "guest", storages: "storage" })[kind]
    ? { kind: { nodes: "node", guests: "guest", storages: "storage" }[kind] }
    : {};
const validId = (value) => {
  if (!mongoose.isValidObjectId(value)) fail("Некорректный идентификатор", 422);
  return value;
};
const populate = (q) =>
  q
    .populate("companyId", "alias fullTitle")
    .populate("connectionId", "name clusterName isCluster monitoringEnabled");
const list = async (kind, query = {}, access = {}) => {
  const Model = modelFor(kind);
  const filter = kindFilter(kind);
  if (["connections", "nodes", "guests", "storages"].includes(kind))
    filter.archived = false;
  for (const key of ["companyId", "connectionId"])
    if (query[key])
      filter[key] =
        key === "companyId" && query[key] === "unassigned"
          ? null
          : validId(query[key]);
  let facets;
  if (kind === "nodes") {
    const scope = { kind: "node", archived: false };
    if (Object.hasOwn(filter, "companyId")) scope.companyId = filter.companyId;
    const allNodes = await Resource.find(scope)
      .select("connectionId")
      .populate("connectionId", "clusterName isCluster")
      .lean();
    const groups = new Map();
    for (const node of allNodes) {
      const c = node.connectionId;
      const value =
        c?.isCluster === true
          ? id(c)
          : c?.isCluster === false
            ? "standalone"
            : "unknown";
      if (!groups.has(value))
        groups.set(value, {
          value,
          label:
            value === "standalone"
              ? "Вне кластера"
              : value === "unknown"
                ? "Кластер не определён"
                : c.clusterName || "Кластер без имени",
          count: 0,
          ids: new Set(),
        });
      const group = groups.get(value);
      group.count++;
      group.ids.add(id(c));
    }
    facets = {
      clusters: [...groups.values()].map(({ value, label, count }) => ({
        value,
        label,
        count,
      })),
    };
    if (query.clusterId) {
      const selected = String(query.clusterId);
      const criterion =
        selected === "unknown"
          ? {
              $nin: [...groups.values()]
                .filter((group) => group.value !== "unknown")
                .flatMap((group) => [...group.ids]),
            }
          : selected === "standalone"
            ? { $in: [...(groups.get(selected)?.ids || [])] }
            : validId(selected);
      if (filter.connectionId)
        filter.$and = [
          { connectionId: filter.connectionId },
          { connectionId: criterion },
        ];
      else filter.connectionId = criterion;
    }
  }
  if (query.status) filter.status = String(query.status).slice(0, 40);
  if (kind === "guests") {
    const scope = { kind: "guest", archived: false };
    for (const key of ["companyId", "connectionId"])
      if (Object.hasOwn(filter, key)) scope[key] = filter[key];
    const guests = await Resource.find(scope).select("guestOs.name").lean();
    const counts = new Map();
    for (const row of guests) {
      const name = row.guestOs?.name || "unknown";
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    facets = {
      ...facets,
      operatingSystems: [...counts]
        .map(([value, count]) => ({
          value,
          label: value === "unknown" ? "ОС не определена" : value,
          count,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
    };
  }
  const disabledParents =
    (query.state || query.exposure) && ["guests", "nodes"].includes(kind)
      ? await Connection.find({ archived: false, monitoringEnabled: false })
          .select("_id")
          .lean()
      : [];
  applyMonitoringFilters(
    filter,
    query,
    kind,
    new Date(),
    disabledParents.map((connection) => connection._id),
  );
  if (kind === 'guests') require('./exposure/query').applyExposureFilter(filter, query.exposure, { prefs:access.prefs, now:new Date(), disabledConnectionIds:disabledParents.map(row=>row._id) });
  if (query.search) {
    const escaped = String(query.search)
      .slice(0, 100)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchFields =
      kind === "connections" ? ["name", "endpoints.host"] : ["name"];
    filter.$or = searchFields.map((field) => ({
      [field]: new RegExp(escaped, "i"),
    }));
    if (/^\d+$/.test(query.search) && Model === Resource)
      filter.$or.push({ vmid: Number(query.search) });
  }
  const page = Math.max(1, parseInt(query.page) || 1),
    pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize) || 30));
  const sort = ["name", "createdAt", "status"].includes(query.sort)
    ? query.sort
    : "createdAt";
  const order = query.order === "asc" ? 1 : -1;
  let q = Model.find(filter)
    .sort({ [sort]: order, _id: 1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .populate("companyId", "alias fullTitle");
  if (Model !== Connection)
    q = q.populate(
      "connectionId",
      "name clusterName isCluster monitoringEnabled",
    );
  const [rows, total] = await Promise.all([
    q.lean(),
    Model.countDocuments(filter),
  ]);
  const items = rows.map(view);
  let infrastructure = [];
  if (kind === "guests" && rows.length) {
    const nodes = await Resource.find({
      kind: "node",
      archived: false,
      $or: rows.map((row) => ({
        connectionId: id(row.connectionId),
        nodeName: row.nodeName,
      })),
    })
      .populate("companyId", "alias fullTitle")
      .populate("connectionId", "name clusterName isCluster monitoringEnabled")
      .lean();
    infrastructure = nodes.map(view);
    const activeOperations = await Event.find({
      kind: "vmOperation",
      resourceId: { $in: rows.map((row) => row._id) },
      "operationData.active": true,
    }).lean();
    const operationByResource = new Map(
      activeOperations.map((operation) => [
        id(operation.resourceId),
        require("./operationStore").publicView(operation),
      ]),
    );
    const latestOperations = await Event.aggregate([
      {
        $match: {
          kind: "vmOperation",
          resourceId: { $in: rows.map((row) => row._id) },
        },
      },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: "$resourceId", operation: { $first: "$$ROOT" } } },
    ]);
    const latestByResource = new Map(
      latestOperations.map((row) => [
        id(row._id),
        require("./operationStore").publicView(row.operation),
      ]),
    );
    for (const item of items) {
      item.latestOperation = latestByResource.get(item.id) || null;
      item.currentOperation = operationByResource.get(item.id) || null;
      const node = nodes.find(
        (node) =>
          id(node.connectionId) === item.connectionId &&
          node.nodeName === item.nodeName,
      );
      if (node)
        item.node = {
          id: id(node),
          name: node.name,
          company: company(node.companyId),
        };
    }
  }
  const monitored = await require("./monitoring-view").enrich([
    ...items,
    ...infrastructure,
  ], new Date(), access);
  return {
    items: monitored.slice(0, items.length),
    ...(kind === 'guests' ? {exposureEnabled:require('./exposure/contract').enabled(access.prefs)} : {}),
    ...(kind === "guests"
      ? { nodeWarnings: monitored.slice(items.length) }
      : {}),
    total,
    page,
    pageSize,
    ...(facets ? { facets } : {}),
  };
};
const detail = async (kind, value, access = {}) => {
  const Model = modelFor(kind);
  let q = Model.findOne({ _id: validId(value), ...kindFilter(kind) }).populate(
    "companyId",
    "alias fullTitle",
  );
  if (Model !== Connection)
    q = q.populate(
      "connectionId",
      "name clusterName isCluster monitoringEnabled",
    );
  if (Model === Resource)
    q = q.populate("clientDeviceId", "hostname inventoryNumber");
  const row = await q.lean();
  if (!row) fail("Запись не найдена", 404);
  const related = [];
  if (row.kind === "node") {
    const scope = {
      connectionId: id(row.connectionId),
      nodeName: row.nodeName || row.name,
      archived: false,
    };
    const [guests, storages] = await Promise.all(
      ["guest", "storage"].map((kind) =>
        Resource.find({ ...scope, kind })
          .limit(100)
          .populate("companyId", "alias fullTitle")
          .lean(),
      ),
    );
    related.push(...guests, ...storages);
  }
  if (row.kind === "guest") {
    const storages = await Resource.find({
      connectionId: id(row.connectionId),
      kind: "storage",
      nodeName: row.nodeName,
      archived: false,
      storageContent: "backup",
    }).lean();
    related.push(...storages);
  }
  const item = view(row);
  if (row.kind === "guest") {
    const operations = require("./operationStore");
    item.currentOperation = operations.publicView(
      await operations.findOne({ resourceId: row._id, active: true }),
    );
    item.latestOperation = operations.publicView(
      await Event.findOne({ kind: "vmOperation", resourceId: row._id })
        .sort({ createdAt: -1, _id: -1 })
        .lean(),
    );
    const node = await Resource.findOne({
      connectionId: id(row.connectionId),
      kind: "node",
      nodeName: row.nodeName,
    })
      .populate("companyId", "alias fullTitle")
      .lean();
    if (node)
      item.node = {
        id: id(node),
        name: node.name,
        company: company(node.companyId),
      };
  }
  return {
    item: (await require("./monitoring-view").enrich([item], new Date(), access))[0],
    related: {
      guests: related.filter((r) => r.kind === "guest").map(view),
      nodes: related.filter((r) => r.kind === "node").map(view),
      storages: related.filter((r) => r.kind === "storage").map(view),
    },
  };
};
const events = async (resourceId, query = {}) => {
  const filter = {
    resourceId: validId(resourceId),
    kind: { $ne: "vmOperation" },
  };
  const page = Math.max(1, parseInt(query.page) || 1),
    pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize) || 30));
  const [items, total] = await Promise.all([
    Event.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Event.countDocuments(filter),
  ]);
  return { items: items.map(view), total, page, pageSize };
};
const availability = async (resourceId, days = 30) =>
  require("./availability").summary(validId(resourceId), days);
const metrics = async (resourceId, timeframe = "day") => {
  if (!["hour", "day", "week", "month", "year"].includes(timeframe))
    fail("Некорректный период");
  const r = await Resource.findById(validId(resourceId));
  if (!r) fail("Ресурс не найден", 404);
  if (r.monitoringEnabled === false) fail("Мониторинг ресурса выключен", 409);
  const c = await Connection.findById(r.connectionId).select("+tokenSecret");
  if (!c || c.archived || r.archived || !c.monitoringEnabled)
    fail("Мониторинг подключения недоступен", 409);
  const base = `/nodes/${encodeURIComponent(r.nodeName)}`;
  const path =
    r.kind === "guest"
      ? `${base}/${r.guestType}/${r.vmid}`
      : r.kind === "storage"
        ? `${base}/storage/${encodeURIComponent(r.externalId.split("/").pop())}`
        : base;
  return {
    items: await require("./transport").request(
      c,
      `${path}/rrddata?timeframe=${timeframe}&cf=AVERAGE`,
    ),
    timeframe,
  };
};
module.exports = {
  id,
  view,
  list,
  detail,
  events,
  availability,
  metrics,
  validId,
  company,
  populate,
};
