const mongoose = require("mongoose");

const { guardRecipient } = require("../utils/mailGuard");

const Schema = mongoose.Schema;

const notificationSchema = new Schema(
  {
    instrument: {
      type: String,
      enum: ["email", "telegram"],
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
    },
    commentId: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
    },
    to: {
      chatId: String,
      globalChat: Boolean,
      // Ветка форум-группы для групповых уведомлений (notify.byTelegram.messageThreadId)
      messageThreadId: String,
      companyChat: String,
      applicant: String,
      responsible: String,
      manager: String,
      email: String,
    },
    title: String,
    text: String,
    // Готовое HTML-тело письма. Пусто — отправщик соберёт письмо из text, как
    // раньше: у большинства уведомлений своей вёрстки нет и не нужно
    html: { type: String, default: null },
    replyMarkup: { type: Schema.Types.Mixed },
    sent: { type: Boolean, default: false },
    failed: { type: Boolean, default: false },
    attemptsCounter: { type: Number, default: 0 },
    // Кому письмо предназначалось до подмены получателя вне прода. Пусто на
    // проде; на деве видно, кому оно ушло бы «по-настоящему».
    intendedEmail: { type: String, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ instrument: 1, sent: 1, failed: 1 });

/**
 * Вне прода письмо не может уйти клиенту. Подмена стоит прямо в модели, а не в
 * двадцати местах, где создаются уведомления (middleware/notifications.js,
 * services/*Notifications.js, контроллер Mikrotik): «без исключений» иначе не
 * гарантировать — новое место создания просто забудут прикрыть.
 * Дублирующая защита стоит у отправщика (telegram-bot).
 */
const guardDocument = (doc) => {
  if (!doc || doc.instrument !== "email") {
    return;
  }
  const intended = doc.to?.email;
  const actual = guardRecipient(intended, { module: "notificationModel" });
  if (actual !== intended) {
    doc.intendedEmail = intended;
    doc.to.email = actual;
  }
};

// Mongoose 9 убрал колбэк-стиль: middleware больше не получает `next`, вместо
// него ожидается синхронная функция или промис. Прежняя запись с `next` даёт
// «TypeError: next is not a function» — то есть сохранение падает целиком.
notificationSchema.pre("save", function preSave() {
  guardDocument(this);
});

notificationSchema.pre("insertMany", function preInsertMany(docs) {
  (docs || []).forEach(guardDocument);
});

module.exports = mongoose.model("Notification", notificationSchema);
