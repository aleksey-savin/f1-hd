const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const commentSchema = new Schema(
  {
    content: {
      type: String,
      required: true,
    },
    // Цитируемая переписка, отрезанная от почтового ответа (хвост письма).
    // В content остаётся только новый текст; хвост раскрывается в UI по клику.
    quotedText: {
      type: String,
    },
    attachments: [
      {
        mimetype: String,
        name: String,
        originalName: String,
      },
    ],
    // Сообщение «Диалогов», которое стало этим комментарием, или ответ из
    // заявки, ушедший мессенджером. Только имена — ни телефона, ни ника: блок
    // видит и клиент в своей заявке.
    channel: {
      network: { type: String, default: undefined },
      conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: undefined },
      messageId: { type: Schema.Types.ObjectId, ref: "Message", default: undefined },
      direction: { type: String, enum: ["in", "out", undefined], default: undefined },
      authorName: { type: String, default: undefined },
      status: { type: String, default: undefined },
      statusAt: { type: Date, default: undefined },
      error: { type: String, default: undefined },
      editedAt: { type: Date, default: undefined },
      deletedAt: { type: Date, default: undefined },
    },
    // legacy, delete after 1.8.9
    ticket: {
      type: Number,
    },
    // ---------------
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
    },
    notifications: {
      lastAction: String,
      pending: Boolean,
      // Ответ ушёл клиенту мессенджером (services/messaging): заявителю тот же
      // текст уведомлением не дублируем — ни письмом, ни ботом, ни в приложении
      skipApplicant: Boolean,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

// Новый комментарий — движение заявки (точка «непрочитано» в списках, см.
// services/ticketSeen.js). Пометку «новый» берём в pre-save: в post-save
// isNew уже сброшен. Хук асинхронный, и Mongoose его дожидается — поэтому
// «отметить просмотренным» после `comment.save()` гарантированно позже
// движения. Сбой обновления комментарий не роняет.
commentSchema.pre("save", function rememberNew() {
  this.$locals.wasNew = this.isNew;
});
commentSchema.post("save", async function bumpTicketActivity(doc) {
  if (!doc.$locals || !doc.$locals.wasNew) return;
  try {
    await mongoose.model("Ticket").updateOne(
      {
        _id: doc.ticketId,
        // Только вперёд: зеркало сообщения из мессенджера несёт время
        // мессенджера и может оказаться старше последнего движения заявки
        $or: [{ "activity.at": { $lte: doc.createdAt || new Date() } }, { "activity.at": null }],
      },
      {
        $set: {
          activity: { at: doc.createdAt || new Date(), by: doc.createdBy },
        },
      },
    );
  } catch (error) {
    console.warn(
      "activity заявки не обновлена по комментарию:",
      error?.message || error,
    );
  }
});

// Живые обновления: комментарий двигает свою заявку (см. services/pulseTopics.js)
commentSchema.plugin(require("../services/pulsePlugin"), { model: "Comment" });

// Комментарии заявки для MCP (services/mcp/ticketSource.js) ищутся по ticketId:
// письма до 2026-07-08 не попали в массив заявки.
commentSchema.index({ ticketId: 1, createdAt: 1 });
commentSchema.index(
  { "channel.messageId": 1 },
  { unique: true, partialFilterExpression: { "channel.messageId": { $exists: true } }, name: "channel_messageId_unique" },
);
// Крон repairOutbound ищет застрявшие "preparing" — без частичного индекса он
// сканировал бы всю коллекцию comments раз в минуту (построится один раз при
// деплое, см. docs/messaging.md §8)
commentSchema.index(
  { createdAt: 1 },
  { partialFilterExpression: { "channel.status": "preparing" }, name: "channel_preparing_createdAt" },
);

module.exports = mongoose.model("Comment", commentSchema);
