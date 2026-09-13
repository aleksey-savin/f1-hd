const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Снимок производственного календаря страны за год. Хранятся ТОЛЬКО
// дни-исключения: обычные суббота и воскресенье выводятся из дня недели, как и
// раньше в расчёте переработок. Источник — xmlcalendar.ru (даёт названия
// праздников и переносы), фолбэк — isdayoff.ru, последний рубеж — снимок
// backend/data/production-calendar/<cc>-<год>.json.
//
// Типы дней (нормализованы из t/h/f формата xmlcalendar):
//   holiday — нерабочий праздничный (t=1 + h);
//   dayoff  — нерабочий из-за переноса (t=1 + f), сам по себе не праздник;
//   short   — рабочий, но на час короче (t=2, предпраздничный);
//   work    — рабочая суббота/воскресенье (t=3). В 2026 таких нет, но переносы
//             их порождают регулярно, и расчёт обязан их понимать.
const calendarDaySchema = new Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD, календарная дата
    type: {
      type: String,
      enum: ["holiday", "dayoff", "short", "work"],
      required: true,
    },
    holidayId: { type: Number, default: null },
    transferredFrom: { type: String, default: null }, // YYYY-MM-DD
  },
  { _id: false },
);

const productionCalendarSchema = new Schema(
  {
    country: { type: String, required: true, lowercase: true },
    year: { type: Number, required: true },
    source: {
      type: String,
      enum: ["xmlcalendar", "isdayoff", "bundled"],
      required: true,
    },
    fetchedAt: { type: Date, default: Date.now },
    holidays: [
      {
        _id: false,
        id: { type: Number, required: true },
        title: { type: String, required: true },
      },
    ],
    days: [calendarDaySchema],
    // Самопроверка загрузчика: норма года по 40-часовой неделе должна сойтись
    // с этими числами (у xmlcalendar они приходят готовыми).
    statistic: {
      workdays: { type: Number, default: null },
      hours40: { type: Number, default: null },
    },
  },
  { timestamps: true },
);

productionCalendarSchema.index({ country: 1, year: 1 }, { unique: true });

// Живые обновления календаря команды (см. services/pulseTopics.js)
productionCalendarSchema.plugin(require("../services/pulsePlugin"), {
  model: "ProductionCalendar",
});

module.exports = mongoose.model("ProductionCalendar", productionCalendarSchema);
