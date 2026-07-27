// Дефолтные параметры расчёта переработок (Preferences.overtime).
// Используются моделью Preferences как schema-default для новых документов,
// сервисом workOvertime как fallback (пока админ не сохранил настройки) и как
// заготовка личного графика сотрудника (services/workCalendar).
//
// breakMinutes: 60 — окно 09:00–18:00 даёт 9 часов присутствия, а норма по
// производственному календарю считается от 8-часового дня. Перерыв вычитается
// только из НОРМЫ; границы переработки он не двигает (см. models/workSchedule).
const workDay = () => ({
  isWorking: true,
  is24hours: false,
  start: "09:00",
  end: "18:00",
  breakMinutes: 60,
});

const restDay = () => ({
  isWorking: false,
  is24hours: false,
  start: "09:00",
  end: "18:00",
  breakMinutes: 0,
});

const DEFAULT_OVERTIME_SCHEDULE = Object.freeze({
  Monday: workDay(),
  Tuesday: workDay(),
  Wednesday: workDay(),
  Thursday: workDay(),
  Friday: workDay(),
  Saturday: restDay(),
  Sunday: restDay(),
});

const DEFAULT_OVERTIME_SETTINGS = Object.freeze({
  defaultSchedule: DEFAULT_OVERTIME_SCHEDULE,
  defaultTariffingPeriodMinutes: 15,
  weekdayCoefficient: 1,
  weekendCoefficient: 1,
  // null — «как в выходной»: см. Preferences.overtime.holidayCoefficient
  holidayCoefficient: null,
});

module.exports = { DEFAULT_OVERTIME_SCHEDULE, DEFAULT_OVERTIME_SETTINGS };
