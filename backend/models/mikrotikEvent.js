const mongoose = require("mongoose");
const { GROUPS, SEVERITIES, KIND_NAMES } = require("@/services/mikrotik/eventKinds");

const Schema = mongoose.Schema;

/**
 * Событие журнала устройства Mikrotik: что произошло с устройством и кто это сделал.
 *
 * Сюда сходятся простои, перезагрузки, обновления, копии конфигурации, правки записи,
 * действия ИИ-агентов через MCP и значимые строки лога самого роутера. Исходные
 * хранилища (MikrotikOutage, MikrotikUpgradeJob, MikrotikChange, MikrotikArtifact)
 * остаются источником правды для своих разделов; журнал — их общая лента.
 *
 * Пишет только services/mikrotik/events.js. Вид — из каталога eventKinds.js.
 */
const RETENTION_DAYS = 365;

const mikrotikEventSchema = new Schema(
  {
    mikrotik: { type: Schema.Types.ObjectId, ref: "Mikrotik", required: true },
    // Когда произошло. У свёрнутых обращений агента — время последнего (начало в data.since)
    at: { type: Date, required: true },
    kind: { type: String, enum: KIND_NAMES, required: true },
    group: { type: String, enum: GROUPS, required: true },
    severity: { type: String, enum: SEVERITIES, default: "info" },
    // Кто: человек HD (userId, имя подставляется при чтении), ключ агента (имя снимком —
    // ключ могут удалить), учётная запись роутера (name) или сама система
    actor: {
      type: { type: String, enum: ["system", "user", "mcpKey", "routerUser"], default: "system" },
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      name: String,
      keyId: { type: Schema.Types.ObjectId, ref: "McpKey" },
      keyName: String,
      // От чьего имени действует агент
      onBehalfOf: { type: Schema.Types.ObjectId, ref: "User" },
    },
    // Небольшой объект вида: from/to, изменённые поля, счётчики, строки лога роутера
    data: { type: Schema.Types.Mixed, default: undefined },
    // Отредактированные строки отличий конфигурации; наружу — только с правом на конфигурации
    diff: { type: [String], default: undefined },
    refs: {
      changeId: { type: Schema.Types.ObjectId, ref: "MikrotikChange" },
      upgradeJobId: { type: Schema.Types.ObjectId, ref: "MikrotikUpgradeJob" },
      artifactId: { type: Schema.Types.ObjectId, ref: "MikrotikArtifact" },
      ticketId: { type: Schema.Types.ObjectId, ref: "Ticket" },
    },
    // Сколько обращений свёрнуто в строку
    count: { type: Number, default: 1 },
    // Идемпотентность переноса прошлого и строк лога роутера
    dedupeKey: { type: String },
  },
  { timestamps: true },
);

mikrotikEventSchema.index({ mikrotik: 1, at: -1, _id: -1 });
mikrotikEventSchema.index({ mikrotik: 1, group: 1, at: -1, _id: -1 });
mikrotikEventSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);
// Срок хранения: старое стирает сама база
mikrotikEventSchema.index({ at: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });

// Раздел «Журнал» узнаёт о новых событиях из пульса (см. services/pulseTopics.js)
mikrotikEventSchema.plugin(require("../services/pulsePlugin"), { model: "MikrotikEvent" });

module.exports = mongoose.model("MikrotikEvent", mikrotikEventSchema);
module.exports.RETENTION_DAYS = RETENTION_DAYS;
