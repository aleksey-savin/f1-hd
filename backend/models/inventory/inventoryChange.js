const mongoose = require("mongoose");

const Counter = require("../counter");
const { STATUS } = require("@/services/inventory/changeSteps");

const Schema = mongoose.Schema;

// Предложение ИИ-агента по инвентарю: пакет операций, который утверждает
// заявитель. Каждая операция хранит всё, что нужно applyPackage
// (services/inventory/changeOps), чтобы применить пакет по одной записи из базы.

const RESULT_STATES = ["pending", "done", "failed", "skipped"];

const operationSchema = new Schema(
  {
    kind: { type: String, required: true },
    // Имя результата операции для ссылок { ref } в параметрах следующих
    ref: String,
    // Параметры как их прислал агент, ссылки не раскрыты
    params: Schema.Types.Mixed,
    // Запись операции для согласующего
    text: String,
    // Вид операции для страницы портала, взят при предложении:
    // { head, subs, fields:[{ label, value, before? }], links:[{ model, id, label }], deferred }.
    // У предложений до страницы его нет — страница строится из text
    page: Schema.Types.Mixed,
    // Снимок updatedAt затрагиваемых сущностей: при применении расхождение — дрейф
    targets: [
      {
        _id: false,
        model: String,
        id: Schema.Types.ObjectId,
        updatedAt: Date,
      },
    ],
    // Снимок живых деталей хоста для каскада (assign/move/status), взят при проверке
    componentIds: { type: [Schema.Types.ObjectId], default: undefined },
    // Детали каскада, которые создаёт более ранняя операция пакета: ref этих
    // операций; при применении их id дописываются к componentIds
    componentRefs: { type: [String], default: undefined },
    result: {
      state: { type: String, enum: RESULT_STATES, default: "pending" },
      error: String,
      // Созданное операцией: { [вид]: id } или { type:{key:id}, attribute:{key:id}, group:{key:id} }
      created: Schema.Types.Mixed,
      at: Date,
    },
  },
  { _id: false },
);

const inventoryChangeSchema = new Schema(
  {
    // Сквозной номер (nextInventoryChangeNumber); людям не показывается
    number: { type: Number, required: true, unique: true },
    title: String,
    reason: String,
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Каким ключом MCP пришло предложение
    requestedVia: {
      keyId: { type: Schema.Types.ObjectId, ref: "McpKey" },
      keyName: String,
    },
    operations: [operationSchema],
    status: {
      type: String,
      enum: Object.values(STATUS),
      default: STATUS.awaitingRequester,
    },
    decision: {
      user: { type: Schema.Types.ObjectId, ref: "User" },
      decision: { type: String, enum: ["approve", "reject"] },
      channel: String,
      comment: String,
      at: Date,
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
    expiresAt: Date,
    // Когда предложение ушло в применение (застрявшее ищется по нему)
    applyingSince: Date,
    // sweep счёл применение прервавшимся (failed — догадка): живой итог перезапишет и снимет флаг
    stuck: { type: Boolean, default: undefined },
  },
  { timestamps: true },
);

inventoryChangeSchema.index({ requestedBy: 1, status: 1 });
inventoryChangeSchema.index({ status: 1, expiresAt: 1 });
inventoryChangeSchema.index({ "requestedVia.keyId": 1, createdAt: -1 });

inventoryChangeSchema.statics.nextInventoryChangeNumber = async function () {
  const counter = await Counter.findOneAndUpdate(
    { _id: "inventoryChange" },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return counter.seq;
};

// Live updates (see services/pulseTopics.js)
inventoryChangeSchema.plugin(require("../../services/pulsePlugin"), {
  model: "InventoryChange",
});

module.exports =
  mongoose.models.InventoryChange ||
  mongoose.model("InventoryChange", inventoryChangeSchema);
