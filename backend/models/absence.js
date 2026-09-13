const mongoose = require("mongoose");

const { ABSENCE_TYPE_CODES, ABSENCE_STATUSES } = require("../utils/absenceTypes");

const Schema = mongoose.Schema;

// Отсутствие сотрудника с периодом и согласованием.
//
// До этой модели «отпуск» и «больничный» жили только как мгновенный флаг
// user.workStatus.code — без дат, без истории и без влияния на норму часов.
//
// from/to — КАЛЕНДАРНЫЕ ДАТЫ, лежат UTC-полночью и ходят строками YYYY-MM-DD
// (docs/datetime-conventions.md, раздел «Модель данных»): это не инстанты,
// сдвигать их зоной нельзя. Период включительный: from = to — один день.
const absenceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ABSENCE_TYPE_CODES,
      required: true,
    },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    comment: { type: String, default: "", maxlength: 300 },

    status: {
      type: String,
      enum: ABSENCE_STATUSES,
      default: "pending",
      required: true,
    },
    // Кто подал. Совпадает с user, когда сотрудник просит за себя; отличается,
    // когда отсутствие завёл обладатель права canManageWorkSchedules.
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    decidedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    decidedAt: { type: Date, default: null },
    // Причина отказа — уходит заявителю в уведомлении, поэтому человеческая
    decisionComment: { type: String, default: "", maxlength: 300 },
  },
  { timestamps: true },
);

// Выборка табеля: «все отсутствия сотрудников за период»
absenceSchema.index({ user: 1, from: 1, to: 1 });
// Очередь «ждут решения» и подсветка периода
absenceSchema.index({ status: 1, from: 1 });

// Живые обновления календаря команды (см. services/pulseTopics.js)
absenceSchema.plugin(require("../services/pulsePlugin"), { model: "Absence" });

module.exports = mongoose.model("Absence", absenceSchema);
