const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const attachmentSchema = new Schema(
  {
    name: { type: String, default: "" },
    originalName: { type: String, default: "" },
    mimetype: { type: String, default: "" },
    size: { type: Number, default: 0 },
    durationSec: { type: Number, default: null },
    // skipped — больше лимита или из истории: шлюз скачает по клику (fetchMedia)
    status: { type: String, enum: ["ready", "pending", "skipped", "failed"], default: "ready" },
    externalRef: { type: String, default: "" },
  },
  { _id: false },
);

/**
 * Сообщение диалога — входящее, исходящее или системная строка («Создана
 * заявка №…»). Повтор события от шлюза узнаётся уникальным индексом по
 * внешнему id; шаги приёма, уже сделанные для сообщения, записаны в `effects`
 * — транзакций у нас нет (MongoDB standalone), и повтор доделывает только
 * недоделанное.
 */
const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true },
    externalChatId: { type: String, required: true },
    externalId: { type: String, default: undefined },
    // Длинный текст шлюз режет на части — у каждой свой id
    externalIds: { type: [String], default: undefined },
    seq: { type: Number, required: true },
    direction: { type: String, enum: ["in", "out", "system"], required: true },
    origin: {
      type: String,
      enum: ["client", "staff", "hd", "device", "form", "system"],
      required: true,
    },
    kind: {
      type: String,
      enum: ["text", "photo", "voice", "audio", "video", "document", "sticker", "location", "contact", "form", "other", "event"],
      default: "text",
    },
    identityId: { type: Schema.Types.ObjectId, ref: "ChannelIdentity", default: null },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    authorName: { type: String, default: "" },
    text: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
    form: {
      fields: { type: [{ _id: false, label: String, value: String }], default: undefined },
    },
    replyToExternalId: { type: String, default: null },
    replyToId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    sentAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["received", "queued", "sent", "delivered", "read", "failed"],
      default: "received",
    },
    error: { type: String, default: "" },
    jobId: { type: Schema.Types.ObjectId, ref: "ChannelJob", default: null },
    editedAt: { type: Date, default: null },
    revisions: { type: [{ _id: false, text: String, at: Date }], default: undefined },
    deletedAt: { type: Date, default: null },
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
    ticketNum: { type: Number, default: null },
    attachMode: {
      type: String,
      enum: ["bound", "reply", "manual", "origin", "deliver", null],
      default: null,
    },
    suggestTicketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
    commentId: { type: Schema.Types.ObjectId, ref: "Comment", default: null },
    imported: { type: Boolean, default: false },
    // Системная строка ленты: что произошло и кто это сделал (имя — копией)
    event: {
      // ticketCreated | bound | unbound | bindingEnded | bindingRestored |
      // handled | assigned | attached
      kind: { type: String, default: undefined },
      ticketNum: { type: Number, default: undefined },
      byUserId: { type: Schema.Types.ObjectId, ref: "User", default: undefined },
      byName: { type: String, default: undefined },
      // Кого назначили / сколько сообщений добавили — для подписи строки
      targetName: { type: String, default: undefined },
      count: { type: Number, default: undefined },
    },
    effects: {
      conversation: { type: Boolean, default: false },
      attach: { type: Boolean, default: false },
      notify: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

messageSchema.index(
  { channelId: 1, externalChatId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: "string" } } },
);
messageSchema.index(
  { commentId: 1 },
  { unique: true, partialFilterExpression: { commentId: { $type: "objectId" } } },
);
messageSchema.index({ conversationId: 1, sentAt: 1, seq: 1 });
messageSchema.index({ conversationId: 1, updatedAt: 1 });
messageSchema.index({ ticketId: 1 });
messageSchema.index({ jobId: 1 }, { sparse: true });
messageSchema.index({ channelId: 1, externalId: 1 });
// repairOutbound.orphans — те же равенства, что в его запросе (см.
// services/messaging/outbound.js), иначе крон раз в минуту сканирует всю messages
messageSchema.index(
  { createdAt: 1 },
  {
    partialFilterExpression: { direction: "out", origin: "hd", status: "queued", jobId: null },
    name: "hd_queued_no_job_createdAt",
  },
);

messageSchema.plugin(require("../services/pulsePlugin"), { model: "Message" });

module.exports = mongoose.model("Message", messageSchema);
