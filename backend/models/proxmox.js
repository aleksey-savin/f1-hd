const mongoose = require("mongoose");
const { Schema } = mongoose;
const ref = (model) => ({ type: Schema.Types.ObjectId, ref: model });
const model = (name, fields, indexes = []) => {
  const schema = new Schema(fields, { timestamps: true });
  for (const [keys, options] of indexes) schema.index(keys, options);
  return mongoose.model(name, schema);
};
const endpoint = new Schema(
  {
    transport: {
      type: String,
      enum: ["direct", "mikrotik"],
      default: "direct",
    },
    host: String,
    port: { type: Number, default: 8006 },
    mikrotikRecordId: ref("Mikrotik"),
    tlsMode: {
      type: String,
      enum: ["system", "ca", "fingerprint", "insecure"],
      default: "system",
    },
    caCert: String,
    fingerprint: String,
  },
  { _id: false },
);
const monitoringIssue = new Schema(
  {
    key: String,
    activeKey: String,
    active: Boolean,
    title: String,
    startedAt: Date,
    companyId: ref("Company"),
    ticketId: ref("Ticket"),
    claimAt: Date,
    lastError: String,
  },
  { _id: false },
);
const monitoringIssues = {
  type: Map,
  of: monitoringIssue,
  default: () => new Map(),
  select: false,
};
const Connection = model("ProxmoxConnection", {
  name: String,
  monitoringIssues,
  companyId: ref("Company"),
  endpoints: [endpoint],
  tokenId: String,
  tokenSecret: { type: String, select: false },
  monitoringEnabled: { type: Boolean, default: true },
  archived: { type: Boolean, default: false },
  status: String,
  lastCheckedAt: Date,
  lastSuccessfulConnectionAt: Date,
  lastError: String,
  failedPolls: { type: Number, default: 0 },
  firstFailureAt: Date,
  blockedByMikrotikId: ref("Mikrotik"),
  version: String,
  clusterIdentity: String,
  clusterName: String,
  isCluster: Boolean,
  lastConfigAt: Date,
  maintenance: { from: Date, until: Date, reason: String },
});
const Resource = model(
  "ProxmoxResource",
  {
    connectionId: ref("ProxmoxConnection"),
    monitoringIssues,
    kind: { type: String, enum: ["node", "guest", "storage"] },
    externalId: String,
    name: String,
    nodeName: String,
    vmid: Number,
    guestType: { type: String, enum: ["qemu", "lxc"] },
    guestIdentity: String,
    guestIncarnation: { type: String, select: false },
    guestNetwork: { type: Schema.Types.Mixed, select: false },
    exposureGeneration: { type: Number, default: 0, select: false },
    exposure: { type: Schema.Types.Mixed, select: false },
    companyId: ref("Company"),
    clientDeviceId: ref("ClientDevice"),
    status: String,
    lastCheckedAt: Date,
    lastError: String,
    configError: String,
    missingSince: Date,
    archived: { type: Boolean, default: false },
    monitoringEnabled: { type: Boolean, default: true },
    expectedRunning: { type: Boolean, default: false },
    guestAgent: new Schema({
      state: { type: String, enum: ["disabled", "restartRequired", "responding", "notResponding", "notInstalled", "unknown", "notApplicable"] },
      enabled: { type: Boolean, default: null },
      installed: { type: Boolean, default: null },
      responding: { type: Boolean, default: null },
      requiresRestart: { type: Boolean, default: false },
      version: { type: String, default: null },
      settings: new Schema({ enabled: Boolean, trimClonedDisks: Boolean, freezeFilesystem: Boolean, type: { type: String, enum: ["virtio", "isa"] } }, { _id: false }),
      checkedAt: Date,
      lastError: String,
    }, { _id: false }),
    guestOs: new Schema({ id: String, name: String, version: String, kernel: String, arch: String }, { _id: false }),
    template: Boolean,
    shared: Boolean,
    storageType: String,
    storageContent: [String],
    resources: {
      cpu: Number,
      memory: Number,
      disk: Number,
      cpuUsage: Number,
      memoryUsed: Number,
      diskUsed: Number,
    },
    disks: [{ _id: false, name: String, storage: String, bytes: Number }],
    lastBackupAt: Date,
    lastBackupError: String,
    maintenance: { from: Date, until: Date, reason: String },
    failureAt: Date,
    failedPolls: { type: Number, default: 0 },
    thresholdSince: { cpu: Date, memory: Date },
    uptime: Number,
    version: String,
    clusterIdentity: String,
    clusterName: String,
    isCluster: Boolean,
  },
  [
    [{ connectionId: 1, kind: 1, externalId: 1 }, { unique: true }],
    [{ companyId: 1, kind: 1 }, {}],
    [
      { clientDeviceId: 1 },
      {
        unique: true,
        partialFilterExpression: { clientDeviceId: { $type: "objectId" } },
      },
    ],
  ],
);
const Event = model(
  "ProxmoxEvent",
  {
    connectionId: ref("ProxmoxConnection"),
    resourceId: ref("ProxmoxResource"),
    companyId: ref("Company"),
    actorId: ref("User"),
    kind: String,
    message: String,
    operationData: new Schema(
      {
        createdBy: ref("User"),
        operation: String,
        overruleShutdown: Boolean,
        cancelRequested: Boolean,
        cancelRequestedAt: Date,
        cancelledBy: ref("User"),
        storage: String,
        idempotencyKey: String,
        state: String,
        active: Boolean,
        nodeName: String,
        upid: String,
        dispatchedAt: Date,
        finishedAt: Date,
        lastCheckedAt: Date,
        error: String,
        log: [String],
        reviewedBy: ref("User"),
        reviewedAt: Date,
        reviewReason: String,
      },
      { _id: false },
    ),
  },
  [
    [{ resourceId: 1, createdAt: -1, _id: -1 }, {}],
    [
      { resourceId: 1 },
      {
        unique: true,
        partialFilterExpression: {
          kind: "vmOperation",
          "operationData.active": true,
        },
      },
    ],
    [
      { "operationData.createdBy": 1, "operationData.idempotencyKey": 1 },
      { unique: true, partialFilterExpression: { kind: "vmOperation" } },
    ],
  ],
);
const Observation = model(
  "ProxmoxObservation",
  {
    resourceId: ref("ProxmoxResource"),
    state: String,
    from: Date,
    until: Date,
    lastSeenAt: Date,
    expiresAt: Date,
    open: Boolean,
  },
  [
    [
      { resourceId: 1 },
      { unique: true, partialFilterExpression: { open: true } },
    ],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);
// One durable check per guest. Internal inventory and execution receipts never
// appear in resource DTOs. A failed refresh retains the last successful report.
const GuestSecurity = model("ProxmoxGuestSecurity", {
  resourceId: { ...ref("ProxmoxResource"), required: true },
  status: { type: String, enum: ["queued", "starting", "collecting", "checking", "completed", "partial", "error", "unavailable", "unsupported"] },
  requestedAt: Date,
  checkedAt: Date,
  lastError: String,
  report: Schema.Types.Mixed,
  inventory: { type: Schema.Types.Mixed, select: false },
  job: { type: Schema.Types.Mixed, select: false },
  leaseToken: { type: String, select: false },
  leaseUntil: { type: Date, select: false },
}, [[{ resourceId: 1 }, { unique: true }], [{ status: 1, updatedAt: 1 }, {}]]);
module.exports = {
  GuestSecurity,
  Observation,
  Connection,
  Resource,
  Event,
};
