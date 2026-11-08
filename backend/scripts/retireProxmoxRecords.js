// Run only after old Proxmox workers are stopped and replacement code deployed.
// Default is inspection; --apply preserves existing tickets, then removes the
// obsolete records. It never creates tickets or executes Proxmox operations.
const migrate = async (db, apply = false) => {
  const names = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map(
      (row) => row.name,
    ),
  );
  const tickets = db.collection("tickets");
  const incidents = names.has("proxmoxincidents")
    ? await db.collection("proxmoxincidents").find({}).toArray()
    : [];
  const tasks = names.has("proxmoxtasks")
    ? await db.collection("proxmoxtasks").find({}).toArray()
    : [];
  const result = {
    legacyMonitoringRecords: incidents.length,
    legacyOperations: tasks.length,
    retainedTickets: 0,
    apply,
  };
  if (apply && names.has("proxmoxtasks")) {
    // Ongoing/unknown commands cannot safely be forgotten: the new worker must
    // migrate their lock/state first. Never execute or resubmit them here.
    if (await db.collection("proxmoxtasks").countDocuments({ active: true }))
      throw new Error(
        "Active legacy Proxmox operations remain; migrate operation locks before cleanup",
      );
  }
  for (const old of incidents) {
    if (!old.ticketId) continue;
    const ticket = await tickets.findOne({ _id: old.ticketId });
    if (!ticket) continue;
    result.retainedTickets++;
    if (!apply) continue;
    const key = `legacy:${old._id}`;
    // Do not attach Proxmox metadata to a shared MikroTik ticket.
    if (ticket.proxmoxIncidentId) {
      const source = {
        key,
        connectionId: old.connectionId,
        resourceId: old.resourceId,
        type: old.type,
        startedAt: old.startedAt,
        ...(old.open
          ? { activeKey: old.key }
          : {
              recoveredAt: old.endedAt || new Date(),
              recoveryCommentAt: old.recoveredCommentAt || new Date(),
            }),
      };
      await tickets.updateOne(
        { _id: ticket._id, proxmoxSource: { $exists: false } },
        { $set: { proxmoxSource: source } },
      );
    }
    if (
      old.open &&
      [
        "availability",
        "cpu",
        "memory",
        "storage",
        "connection",
        "quorum",
      ].includes(old.type)
    ) {
      const collection = db.collection(
        old.resourceId ? "proxmoxresources" : "proxmoxconnections",
      );
      const path = `monitoringIssues.${old.type}`;
      const owner = await collection.findOne({
        _id: old.resourceId || old.connectionId,
      });
      const connection = old.resourceId
        ? await db
            .collection("proxmoxconnections")
            .findOne({ _id: old.connectionId })
        : owner;
      const issue = {
        key: ticket.proxmoxSource?.key || key,
        activeKey: old.key,
        active: true,
        title: old.title,
        startedAt: old.startedAt,
        companyId: old.companyId || connection?.companyId,
        ticketId: ticket._id,
      };
      await collection.updateOne(
        { _id: old.resourceId || old.connectionId, [path]: { $exists: false } },
        { $set: { [path]: issue } },
      );
    }
  }
  if (!apply) return result;
  for (const old of tasks) {
    const {
      _id,
      resourceId,
      connectionId,
      companyId,
      createdAt,
      updatedAt,
      ...operationData
    } = old;
    delete operationData.__v;
    const existing = await db.collection("proxmoxevents").findOne({ _id });
    if (existing && existing.kind !== "vmOperation")
      throw new Error(
        "Legacy operation id conflicts with an existing journal record",
      );
    await db.collection("proxmoxevents").updateOne(
      { _id },
      {
        $setOnInsert: {
          resourceId,
          connectionId,
          companyId,
          createdAt,
          updatedAt,
          actorId: old.createdBy,
          kind: "vmOperation",
          message: "Операция Proxmox: историческая запись",
          operationData,
        },
      },
      { upsert: true },
    );
  }
  // An already cleaned database is safe to run through again.
  await tickets.updateMany(
    { proxmoxIncidentId: { $exists: true } },
    { $unset: { proxmoxIncidentId: "" } },
  );
  for (const index of await tickets.indexes())
    if (Object.hasOwn(index.key, "proxmoxIncidentId"))
      await tickets.dropIndex(index.name);
  await tickets.createIndex(
    { "proxmoxSource.key": 1 },
    {
      unique: true,
      partialFilterExpression: { "proxmoxSource.key": { $type: "string" } },
    },
  );
  await tickets.createIndex(
    { "proxmoxSource.activeKey": 1 },
    {
      unique: true,
      partialFilterExpression: {
        "proxmoxSource.activeKey": { $type: "string" },
      },
    },
  );
  if (names.has("proxmoxevents"))
    await db
      .collection("proxmoxevents")
      .updateMany({}, { $unset: { taskId: "", incidentId: "" } });
  for (const name of ["proxmoxincidents", "proxmoxtasks"])
    if (names.has(name)) await db.collection(name).drop();
  return result;
};
const run = async () => {
  const mongoose = require("mongoose");
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  try {
    console.log(
      JSON.stringify(
        await migrate(mongoose.connection.db, process.argv.includes("--apply")),
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
};
if (require.main === module)
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { migrate };
