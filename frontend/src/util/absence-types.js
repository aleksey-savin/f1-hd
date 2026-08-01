// Каталог типов отсутствий — копия backend/utils/absenceTypes.js.
// Синхронизировать коды, подписи, short, reducesNorm и порядок.
// color здесь — css-переменные токенов присутствия (--ws-st-* в
// styles/tailwind.css): табель говорит на языке бара статусов, а не заводит
// вторую палитру. У бэкенда цвета нет — там каталог только про расчёт.
//
// reducesNorm — отпуск/больничный/отгул означают, что человека НЕТ: в
// календаре он перестаёт быть доступным. Командировка и обучение — он
// работает и остаётся доступным, просто не на месте. (Имя поля историческое:
// на бэкенде тот же флаг вычитает день из нормы часов в отчёте «Сотрудники».)
export const ABSENCE_TYPES = [
  {
    code: "vacation",
    label: "Отпуск",
    short: "От",
    emoji: "🌴",
    reducesNorm: true,
    color: "var(--ws-st-vacation)",
  },
  {
    code: "sick",
    label: "Больничный",
    short: "Б",
    emoji: "🤒",
    reducesNorm: true,
    color: "var(--ws-st-sick)",
  },
  {
    code: "trip",
    label: "Командировка",
    short: "Км",
    emoji: "🚗",
    reducesNorm: false,
    color: "var(--ws-st-trip)",
  },
  {
    code: "dayoff",
    label: "Отгул",
    short: "Ог",
    emoji: "🕘",
    reducesNorm: true,
    color: "var(--ws-st-lunch)",
  },
  {
    code: "unpaid",
    label: "Без содержания",
    short: "Бс",
    emoji: "📄",
    reducesNorm: true,
    color: "var(--ws-st-unset)",
  },
  {
    code: "training",
    label: "Обучение",
    short: "Об",
    emoji: "🎓",
    reducesNorm: false,
    color: "var(--ws-st-remote)",
  },
];

export const getAbsenceType = (code) =>
  ABSENCE_TYPES.find((type) => type.code === code) ?? null;
