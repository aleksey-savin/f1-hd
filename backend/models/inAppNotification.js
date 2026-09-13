const mongoose = require("mongoose");
const { KINDS } = require("@/services/ticketEvents");

const Schema = mongoose.Schema;

/**
 * Уведомление «в приложении» — строка колокольчика у конкретного человека.
 *
 * Не `Notification`: та коллекция — очередь ИСХОДЯЩИХ сообщений (почта,
 * Telegram) без адресата-пользователя и без состояния «прочитано», её читают
 * отправщики. Здесь документ адресован человеку (`userId`), живёт до
 * прочтения (`readAt`) и стирается по сроку — TTL-индекс ниже.
 *
 * Кто и по какому событию его получает — services/inAppNotifications.js.
 * `kind` — вид из каталога событий заявки (services/ticketEvents.js), по нему
 * фронт берёт иконку и тон, как в хронике; для событий вне заявок — свои виды.
 */
const CATEGORIES = [
  "newTicket",
  "respStateUpdate",
  "ticketStateUpdate",
  "ticketDeadlineUpdate",
  "ticketNewComment",
  "scheduledWorks",
  "absenceRequest",
  "absenceDecision",
  "reportApproval",
  "reportDecision",
];

const EXTRA_KINDS = [
  "absenceRequest",
  "absenceDecision",
  "reportApproval",
  "reportDecision",
];
const KIND_NAMES = [...new Set([...Object.keys(KINDS), ...EXTRA_KINDS])];

const RETENTION_DAYS = 90;

const inAppNotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, enum: CATEGORIES, required: true },
    kind: { type: String, enum: KIND_NAMES, required: true },
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
    ticketNum: { type: Number, default: null },
    ticketTitle: { type: String, default: "" },
    commentId: { type: Schema.Types.ObjectId, ref: "Comment", default: null },
    // Снимок автора { _id, firstName, lastName }; null — автора нет (удалён)
    actor: { type: Schema.Types.Mixed, default: null },
    title: { type: String, required: true },
    text: { type: String, default: "" },
    link: { type: String, default: "" },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Список колокольчика и счётчик непрочитанного одного человека
inAppNotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
// «Открыл заявку — её уведомления прочитаны»
inAppNotificationSchema.index({ userId: 1, ticketId: 1 });
// Срок хранения: старое стирает сама база
inAppNotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
);

// Колокольчик узнаёт о новых уведомлениях из пульса (см. services/pulseTopics.js)
inAppNotificationSchema.plugin(require("../services/pulsePlugin"), {
  model: "InAppNotification",
});

module.exports = mongoose.model("InAppNotification", inAppNotificationSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.KIND_NAMES = KIND_NAMES;
