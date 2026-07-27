// Каталог типов отсутствий. Держать в синхронизации с копией на фронте:
// frontend/src/util/absence-types.js (коды, подписи, short, reducesNorm,
// порядок). Копии в telegram-bot нет — он работает через уже существующий
// каталог статусов присутствия (utils/workStatuses.js), см. workStatus ниже.
//
// reducesNorm — ключевое различие: отпуск/больничный/отгул СНИМАЮТ день с
// нормы (человека нет), а командировка и обучение норму не трогают — человек
// работает, и его часы с переработками считаются как обычно.
//
// workStatus — код присутствия, который крон проставляет на время активного
// подтверждённого отсутствия (null — не трогать статус).
const ABSENCE_TYPES = [
  {
    code: "vacation",
    label: "Отпуск",
    short: "От",
    emoji: "🌴",
    reducesNorm: true,
    workStatus: "vacation",
  },
  {
    code: "sick",
    label: "Больничный",
    short: "Б",
    emoji: "🤒",
    reducesNorm: true,
    workStatus: "sick",
  },
  {
    code: "trip",
    label: "Командировка",
    short: "Км",
    emoji: "🚗",
    reducesNorm: false,
    workStatus: "trip",
  },
  {
    code: "dayoff",
    label: "Отгул",
    short: "Ог",
    emoji: "🕘",
    reducesNorm: true,
    workStatus: "absent",
  },
  {
    code: "unpaid",
    label: "Без содержания",
    short: "Бс",
    emoji: "📄",
    reducesNorm: true,
    workStatus: "absent",
  },
  {
    code: "training",
    label: "Обучение",
    short: "Об",
    emoji: "🎓",
    reducesNorm: false,
    workStatus: null,
  },
];

const ABSENCE_TYPE_CODES = ABSENCE_TYPES.map((type) => type.code);

// pending → approved | rejected; cancelled — отозвал сам заявитель.
// В норму и в табель попадают ТОЛЬКО approved.
const ABSENCE_STATUSES = ["pending", "approved", "rejected", "cancelled"];

const BY_CODE = new Map(ABSENCE_TYPES.map((type) => [type.code, type]));

const getAbsenceType = (code) => BY_CODE.get(code) || null;

const reducesNorm = (code) => Boolean(BY_CODE.get(code)?.reducesNorm);

module.exports = {
  ABSENCE_TYPES,
  ABSENCE_TYPE_CODES,
  ABSENCE_STATUSES,
  getAbsenceType,
  reducesNorm,
};
