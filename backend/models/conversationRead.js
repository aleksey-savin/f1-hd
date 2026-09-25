const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/** Водяной знак «когда человек последний раз открывал диалог» — как TicketRead. */
const conversationReadSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    seenAt: { type: Date, required: true },
  },
  { timestamps: true },
);

conversationReadSchema.index({ userId: 1, conversationId: 1 }, { unique: true });
conversationReadSchema.index({ conversationId: 1 });

module.exports = mongoose.model("ConversationRead", conversationReadSchema);
