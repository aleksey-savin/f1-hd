const mongoose = require("mongoose");

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
      companyChat: String,
      applicant: String,
      responsible: String,
      manager: String,
      email: String,
    },
    title: String,
    text: String,
    sent: { type: Boolean, default: false },
    failed: { type: Boolean, default: false },
    attemptsCounter: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Notification", notificationSchema);
