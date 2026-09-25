const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Очередь шлюза: отправка сообщений и команды (вход, выход, прочитано,
 * загрузка истории и медиа, проверка прокси). Выдача — арендой, как очередь
 * telegram-уведомлений (controllers/bot.js): findOneAndUpdate атомарен, одно
 * задание дважды не уходит. Порядок в диалоге держит services/messaging/jobs.js.
 */
const channelJobSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    network: { type: String, enum: ["telegram", "whatsapp", "max", "site"], required: true },
    type: {
      type: String,
      enum: ["send", "markRead", "fetchMedia", "login", "logout", "loadHistory", "testProxy"],
      required: true,
    },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: null },
    messageId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    state: { type: String, enum: ["pending", "done", "failed", "cancelled"], default: "pending" },
    notBefore: { type: Date, default: () => new Date() },
    leaseId: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    payload: { type: Schema.Types.Mixed, default: {} },
    result: { type: Schema.Types.Mixed, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

channelJobSchema.index({ state: 1, network: 1, notBefore: 1, createdAt: 1 });
channelJobSchema.index({ conversationId: 1, state: 1, createdAt: 1 });
// repairOutbound.orphans ищет "уже есть задание на это сообщение?" по messageId
channelJobSchema.index({ messageId: 1 });
// Завершённые задания живут 30 дней — для разбора сбоев хватает
channelJobSchema.index(
  { finishedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 3600, partialFilterExpression: { finishedAt: { $type: "date" } } },
);

module.exports = mongoose.model("ChannelJob", channelJobSchema);
