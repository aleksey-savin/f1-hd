const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Водяной знак «когда человек последний раз открывал заявку».
 *
 * Одна запись на пару человек–заявка; сравнение с `ticket.activity` даёт
 * точку «непрочитано» в списках и черту «Новые» в хронике
 * (services/ticketSeen.js, services/ticketUnread.js). Записи нет — заявку
 * ни разу не открывали.
 */
const ticketReadSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true },
    seenAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Upsert по паре и выборка знаков на список заявок одного человека
ticketReadSchema.index({ userId: 1, ticketId: 1 }, { unique: true });
// Уборка при удалении заявки
ticketReadSchema.index({ ticketId: 1 });

module.exports = mongoose.model("TicketRead", ticketReadSchema);
