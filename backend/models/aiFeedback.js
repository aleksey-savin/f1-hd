const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Замечание к работе ИИ — не «палец вниз», а кандидат в правило.
//
// Из «не понравилось» правило не составишь, поэтому причина обязательна, а текст
// объясняет, как правильно. Замечание попадает в хронику заявки сразу, но в
// промпты — только после того, как администратор его включит: иначе одна
// эмоциональная формулировка тихо испортит генерации всему отделу.
//
// Область действия берётся у заявки, на которой замечание оставили: категория и
// компания. Правило без области не бывает — общие наставления модели живут в
// самом промпте, а не здесь.
const aiFeedbackSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true },
    ticketNum: Number,
    // Что именно оказалось не так. Метку ставим только там, где ИИ вписал
    // данные вместо человека (см. docs/ux-ui-guide.md), поэтому целей две.
    target: {
      type: String,
      enum: ["description", "category"],
      required: true,
    },
    reason: {
      type: String,
      enum: ["offtopic", "facts", "invented", "outdated"],
      required: true,
    },
    text: { type: String, default: "" },
    category: {
      _id: { type: Schema.Types.ObjectId, ref: "TicketCategory" },
      title: String,
    },
    company: {
      _id: { type: Schema.Types.ObjectId, ref: "Company" },
      alias: String,
    },
    // Выключено, пока администратор не включил
    isActive: { type: Boolean, default: false },
    activatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    activatedAt: Date,
    createdBy: {
      _id: { type: Schema.Types.ObjectId, ref: "User" },
      firstName: String,
      lastName: String,
    },
  },
  { timestamps: true },
);

// Подбор правил идёт по области при каждой генерации
aiFeedbackSchema.index({ isActive: 1, "category._id": 1 });
aiFeedbackSchema.index({ isActive: 1, "company._id": 1 });

module.exports = mongoose.model("AiFeedback", aiFeedbackSchema);
