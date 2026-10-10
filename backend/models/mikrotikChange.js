const mongoose = require("mongoose");

const Counter = require("./counter");
const { STATUS } = require("@/services/mikrotik/changeSteps");

const Schema = mongoose.Schema;

// Запрос ИИ-агента на изменение конфигурации Mikrotik: команды, согласование
// (заявитель, затем ответственный), снимок результата применения. Секреты
// WireGuard лежат шифртекстом (services/crypto/secretBox) и не читаются без
// явного select.

const RESULT_STATES = ["pending", "done", "failed", "rolled_back", "skipped"];

const commandSchema = new Schema(
  {
    path: String,
    action: String,
    where: Schema.Types.Mixed,
    params: Schema.Types.Mixed,
    // Человекочитаемая запись команды для согласующего
    text: String,
    risk: String,
    riskReason: String,
    // Снимок затрагиваемых строк до применения
    before: Schema.Types.Mixed,
    // .id строки на момент предложения: при применении строка находится заново, и другой .id — это дрейф
    rowId: String,
    result: {
      state: { type: String, enum: RESULT_STATES, default: "pending" },
      error: String,
      // Команде отказал сам роутер (error — его ответ); иначе error — слова HD
      refused: Boolean,
      at: Date,
    },
  },
  { _id: false },
);

const stepSchema = new Schema(
  {
    role: String,
    user: { type: Schema.Types.ObjectId, ref: "User" },
    decision: { type: String, enum: ["approve", "reject"], default: null },
    channel: String,
    comment: String,
    decidedAt: Date,
  },
  { _id: false },
);

const mikrotikChangeSchema = new Schema(
  {
    // Сквозной номер (nextMikrotikChangeNumber)
    number: { type: Number, required: true, unique: true },
    mikrotik: {
      type: Schema.Types.ObjectId,
      ref: "Mikrotik",
      required: true,
      index: true,
    },
    title: String,
    reason: String,
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Каким ключом MCP пришёл запрос
    requestedVia: {
      keyId: { type: Schema.Types.ObjectId, ref: "McpKey" },
      keyName: String,
    },
    // Снимок ответственного на момент запроса
    responsible: { type: Schema.Types.ObjectId, ref: "User", default: null },
    commands: [commandSchema],
    risk: String,
    status: {
      type: String,
      enum: Object.values(STATUS),
      default: STATUS.awaitingRequester,
    },
    expiresAt: Date,
    remindedAt: Date,
    // Когда воркер взял запрос в работу (застрявшее применение ищется по нему)
    applyingSince: Date,
    // Когда запрос впервые попал в очередь применения (отсчёт 30 минут ожидания)
    queuedSince: Date,
    steps: [stepSchema],
    backupArtifact: { type: Schema.Types.ObjectId, ref: "MikrotikArtifact" },
    executor: { type: String, enum: ["safe-mode", "api"] },
    failure: String,
    wireguard: {
      publicKey: String,
      // AES-256-GCM (encryptSecret). Never returned without explicit select.
      privateKey: { type: String, select: false },
      presharedKey: { type: String, select: false },
      client: {
        interface: String,
        address: String,
        // Без default: undefined Mongoose заводит пустые массивы, и у запроса без
        // клиента WireGuard появляется непустой wireguard.client
        allowedIps: { type: [String], default: undefined },
        dns: { type: [String], default: undefined },
        endpoint: String,
      },
      serverPublicKey: String,
      endpoint: String,
      keysExpireAt: Date,
    },
    timeline: [
      {
        _id: false,
        at: Date,
        kind: String,
        user: { type: Schema.Types.ObjectId, ref: "User" },
        text: String,
      },
    ],
  },
  { timestamps: true },
);

mikrotikChangeSchema.index({ mikrotik: 1, createdAt: -1 });
mikrotikChangeSchema.index({ status: 1, expiresAt: 1 });
mikrotikChangeSchema.index({ "steps.user": 1, status: 1 });

mikrotikChangeSchema.statics.nextMikrotikChangeNumber = async function () {
  const counter = await Counter.findOneAndUpdate(
    { _id: "mikrotikChange" },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return counter.seq;
};

// Live updates (see services/pulseTopics.js)
mikrotikChangeSchema.plugin(require("../services/pulsePlugin"), {
  model: "MikrotikChange",
});

module.exports =
  mongoose.models.MikrotikChange ||
  mongoose.model("MikrotikChange", mikrotikChangeSchema);
