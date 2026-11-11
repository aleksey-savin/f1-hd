const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/** Водяной знак «когда человек последний раз открывал диалог» — как TicketRead. */
const conversationReadSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    seenAt: { type: Date, default: null },
    replyContext: {
      ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
      withoutTicket: { type: Boolean, default: false },
      expiresAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

conversationReadSchema.index({ userId: 1, conversationId: 1 }, { unique: true });
conversationReadSchema.index({ conversationId: 1 });

module.exports = mongoose.model("ConversationRead", conversationReadSchema);
