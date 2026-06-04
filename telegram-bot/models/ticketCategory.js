const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Зеркало backend/models/ticketCategory.js — telegram-bot читает категории из той
// же базы для автоопределения категории заявки. Здесь нужны только title,
// description и isActive.
const ticketCategorySchema = new Schema(
  {
    title: { type: String, required: true, unique: true },
    description: { type: String, required: false },
    isActive: { type: Boolean, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("TicketCategory", ticketCategorySchema);
