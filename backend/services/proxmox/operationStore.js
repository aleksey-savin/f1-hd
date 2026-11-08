// Operations are entries of the existing event journal. Partial unique indexes
// provide one active operation per VM and durable actor/key idempotency receipts.
const { Event } = require("../../models/proxmox");
const { fail } = require("./policy");
const { Types } = require("mongoose");
const roots = new Set([
  "_id",
  "resourceId",
  "connectionId",
  "companyId",
  "createdAt",
  "updatedAt",
]);
const field = (key) => (roots.has(key) ? key : `operationData.${key}`);
const query = (filter) => ({
  kind: "vmOperation",
  ...Object.fromEntries(
    Object.entries(filter).map(([key, value]) => [field(key), value]),
  ),
});
const flatten = (row) => {
  if (!row) return null;
  const data = row.toObject ? row.toObject() : row;
  return {
    ...data.operationData,
    _id: data._id,
    resourceId: data.resourceId,
    connectionId: data.connectionId,
    companyId: data.companyId,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};
const update = (body) =>
  Object.fromEntries(
    Object.entries(body).map(([operator, values]) => [
      operator,
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [field(key), value]),
      ),
    ]),
  );
const publicView = (value) => {
  const row = value?.operationData ? flatten(value) : value;
  if (!row) return null;
  return Object.fromEntries(
    [
      "operation",
      "overruleShutdown",
      "cancelRequested",
      "cancelRequestedAt",
      "storage",
      "state",
      "active",
      "nodeName",
      "upid",
      "createdAt",
      "updatedAt",
      "dispatchedAt",
      "finishedAt",
      "lastCheckedAt",
      "error",
      "log",
    ]
      .map((key) => [key, row[key]])
      .concat([
        ["id", String(row._id)],
        ["resourceId", String(row.resourceId)],
      ]),
  );
};
exports.ready = () => Event.init();
exports.findOne = async (filter) =>
  flatten(await Event.findOne(query(filter)).lean());
exports.create = async (data) => {
  const root = {},
    operationData = {};
  for (const [key, value] of Object.entries(data))
    (roots.has(key) ? root : operationData)[key] = value;
  return flatten(
    await Event.create({ ...root, kind: "vmOperation", operationData }),
  );
};
exports.findOneAndUpdate = async (filter, body, options) =>
  flatten(await Event.findOneAndUpdate(query(filter), update(body), options));
exports.updateOne = (filter, body) =>
  Event.updateOne(query(filter), update(body));
exports.active = async () =>
  (
    await Event.find(
      query({
        active: true,
        state: { $in: ["queued", "dispatching", "running"] },
      }),
    )
      .sort({ "operationData.lastCheckedAt": 1, createdAt: 1 })
      .limit(100)
      .lean()
  ).map(flatten);
exports.hasActive = (connectionId) =>
  Event.exists(query({ connectionId, active: true }));
exports.publicView = publicView;
exports.history = async (resourceId, cursor) => {
  const filter = { kind: "vmOperation", resourceId };
  if (cursor) {
    if (typeof cursor !== "string" || cursor.length > 512)
      fail("Некорректный курсор", 422);
    let c;
    try {
      c = JSON.parse(Buffer.from(String(cursor), "base64url").toString());
    } catch {
      fail("Некорректный курсор", 422);
    }
    if (
      !c ||
      typeof c.id !== "string" ||
      typeof c.at !== "string" ||
      !Types.ObjectId.isValid(c.id) ||
      !Number.isFinite(new Date(c.at).getTime())
    )
      fail("Некорректный курсор", 422);
    filter.$or = [
      { createdAt: { $lt: new Date(c.at) } },
      { createdAt: new Date(c.at), _id: { $lt: new Types.ObjectId(c.id) } },
    ];
  }
  const [rows, total] = await Promise.all([
    Event.find(filter).sort({ createdAt: -1, _id: -1 }).limit(11).lean(),
    Event.countDocuments({ kind: "vmOperation", resourceId }),
  ]);
  const items = rows.slice(0, 10),
    last = items.at(-1);
  return {
    items: items.map(publicView),
    total,
    nextCursor:
      rows.length > 10
        ? Buffer.from(
            JSON.stringify({ at: last.createdAt, id: String(last._id) }),
          ).toString("base64url")
        : null,
  };
};
