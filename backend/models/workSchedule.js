const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const dayScheduleSchema = new Schema({
  isWorking: {
    type: Boolean,
    default: false,
  },
  is24hours: {
    type: Boolean,
    default: false,
  },
  start: {
    type: String,
    default: "09:00",
  },
  end: {
    type: String,
    default: "17:00",
  },
  // Неоплачиваемый перерыв, минут. Влияет ТОЛЬКО на норму часов сотрудника
  // (services/workCalendar): окно 09:00–18:00 — это 9 часов присутствия, а
  // производственный календарь считает 8, и без вычета норма никогда с ним не
  // сойдётся. Границы переработки (calcWorkOvertime) перерыв не двигает.
  // Дефолт 0 — у графиков компаний и тарифов перерыва нет и биллинг клиента
  // не меняется; сотрудникам 60 приходит из DEFAULT_OVERTIME_SCHEDULE.
  breakMinutes: {
    type: Number,
    default: 0,
    min: 0,
  },
});

const workScheduleSchema = new Schema({
  Monday: dayScheduleSchema,
  Tuesday: dayScheduleSchema,
  Wednesday: dayScheduleSchema,
  Thursday: dayScheduleSchema,
  Friday: dayScheduleSchema,
  Saturday: dayScheduleSchema,
  Sunday: dayScheduleSchema,
});

module.exports = workScheduleSchema;
