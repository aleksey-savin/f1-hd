const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Зеркало backend/models/aiFeedback.js — боту нужны только активные правила для
// подбора категории. Пишет замечания карточка заявки, бот их только читает,
// поэтому здесь минимальный набор полей. При правке основной модели
// синхронизируйте этот файл.
const aiFeedbackSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket" },
    target: { type: String, enum: ["description", "category"] },
    reason: { type: String },
    text: { type: String, default: "" },
    category: { _id: Schema.Types.ObjectId, title: String },
    company: { _id: Schema.Types.ObjectId, alias: String },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model("AiFeedback", aiFeedbackSchema);
