const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Диалог «Диалогов»: один чат в одном канале — личный, группа компании или
 * заявка с формы сайта. Сводка (lastMessage, awaitingSince) пишется только
 * «если новее» (services/messaging/ingest.js): события приходят с опозданием и
 * повторами.
 */
const conversationSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    // Тип канала копией — для фильтра и значка без чтения канала
    network: { type: String, enum: ["telegram", "whatsapp", "max", "site"], required: true },
    kind: { type: String, enum: ["direct", "group", "form"], required: true },
    externalChatId: { type: String, required: true },
    externalAliases: { type: [String], default: [] },
    title: { type: String, default: "" },
    counterpartIdentityId: { type: Schema.Types.ObjectId, ref: "ChannelIdentity", default: null },
    participants: [
      {
        _id: false,
        identityId: { type: Schema.Types.ObjectId, ref: "ChannelIdentity" },
        isStaff: { type: Boolean, default: false },
      },
    ],
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    // Личный чат, привязанный к заявке: пока привязка жива, переписка идёт в неё
    binding: {
      ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
      ticketNum: { type: Number, default: null },
      boundAt: { type: Date, default: null },
      boundBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      endedAt: { type: Date, default: null },
      endReason: { type: String, enum: ["closed", "deleted", "manual", null], default: null },
    },
    // Клиент написал после закрытия привязанной заявки: «по заявке №X?»
    decision: {
      ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
      ticketNum: { type: Number, default: null },
      at: { type: Date, default: null },
    },
    assigneeId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    awaitingSince: { type: Date, default: null },
    // Отметка «звонок уже был» для текущего ожидания — колокольчик не дублируется
    waitNotifiedAt: { type: Date, default: null },
    handled: {
      at: { type: Date, default: null },
      by: { type: Schema.Types.ObjectId, ref: "User", default: null },
      how: { type: String, default: null },
    },
    lastMessage: {
      at: { type: Date, default: null },
      direction: { type: String, default: null },
      origin: { type: String, default: null },
      preview: { type: String, default: "" },
      authorName: { type: String, default: "" },
    },
    lastSeq: { type: Number, default: 0 },
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true },
);

conversationSchema.index({ channelId: 1, externalChatId: 1 }, { unique: true });
conversationSchema.index({ hidden: 1, awaitingSince: 1 });
conversationSchema.index({ hidden: 1, "lastMessage.at": -1 });
conversationSchema.index({ companyId: 1, "lastMessage.at": -1 });
conversationSchema.index({ assigneeId: 1, "lastMessage.at": -1 });
conversationSchema.index({ "binding.ticketId": 1 });
conversationSchema.index({ counterpartIdentityId: 1 });
conversationSchema.index({ "participants.identityId": 1 });

conversationSchema.plugin(require("../services/pulsePlugin"), { model: "Conversation" });

module.exports = mongoose.model("Conversation", conversationSchema);
