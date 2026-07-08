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

module.exports = mongoose.model("Comment", commentSchema);
