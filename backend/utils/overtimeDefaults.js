// Дефолтные параметры расчёта переработок (Preferences.overtime).
// Используются моделью Preferences как schema-default для новых документов и
// сервисом personalReportService как fallback, пока админ не сохранил настройки.
const DEFAULT_OVERTIME_SCHEDULE = Object.freeze({
  Monday: { isWorking: true, is24hours: false, start: "09:00", end: "18:00" },
  Tuesday: { isWorking: true, is24hours: false, start: "09:00", end: "18:00" },
  Wednesday: { isWorking: true, is24hours: false, start: "09:00", end: "18:00" },
  Thursday: { isWorking: true, is24hours: false, start: "09:00", end: "18:00" },
  Friday: { isWorking: true, is24hours: false, start: "09:00", end: "18:00" },
  Saturday: { isWorking: false, is24hours: false, start: "09:00", end: "18:00" },
  Sunday: { isWorking: false, is24hours: false, start: "09:00", end: "18:00" },
});

const DEFAULT_OVERTIME_SETTINGS = Object.freeze({
  defaultSchedule: DEFAULT_OVERTIME_SCHEDULE,
  defaultTariffingPeriodMinutes: 15,
  weekdayCoefficient: 1,
  weekendCoefficient: 1,
});

module.exports = { DEFAULT_OVERTIME_SCHEDULE, DEFAULT_OVERTIME_SETTINGS };
