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
