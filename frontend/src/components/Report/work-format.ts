import type {
  FinanceStatusKey,
  WorkClassKey,
} from "../../types/employeesReport";

// Общий словарь раздела «Сотрудники»: классы работ и статусы согласования.
// Цвета классов — те же слоты палитры, что в «Аналитике» (взгляд не
// переучивается между отчётами); статусы согласования используют статусные
// цвета и в палитру серий не лезут.

export const WORK_CLASSES: {
  key: WorkClassKey;
  label: string;
  plural: string;
  color: string;
}[] = [
  {
    key: "onSite",
    label: "Выезды",
    plural: "выездов",
    color: "var(--chart-1)",
  },
  {
    key: "remote",
    label: "Удалённо",
    plural: "удалённых",
    color: "var(--chart-2)",
  },
  {
    key: "routineTask",
    label: "Регламент",
    plural: "регламентных",
    color: "var(--chart-3)",
  },
];

export const WORK_CLASS_LABEL: Record<WorkClassKey, string> = {
  onSite: "Выезд",
  remote: "Удалённо",
  routineTask: "Регламент",
};

// Порядок — от согласованного к проблемному (так же выстроена полоса статусов)
export const FINANCE_STATUSES: {
  key: FinanceStatusKey;
  label: string;
  color: string;
}[] = [
  { key: "approved", label: "Утверждено", color: "var(--primary)" },
  { key: "underReview", label: "На проверке", color: "var(--warning)" },
  { key: "pendingApproval", label: "На утверждении", color: "var(--info)" },
  { key: "preview", label: "Превью", color: "var(--faint)" },
  { key: "declined", label: "Отклонено", color: "var(--destructive)" },
  { key: "none", label: "Вне биллинга", color: "var(--faint)" },
];

export const financeStatusMeta = (status: FinanceStatusKey | null) =>
  FINANCE_STATUSES.find((item) => item.key === (status || "none")) ??
  FINANCE_STATUSES[FINANCE_STATUSES.length - 1];

// Минуты → «Ч:ММ» (формат времени работ во всём приложении)
export const formatMinutes = (minutes: number) => {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// Деньги — целыми рублями с разделителями разрядов. Округление обязательно:
// расчёт даёт дроби (833.3333…), и без него в карточке появлялось
// «135 833,333 ₽».
//
// undefined — не «ноль», а «сервер поля не присылал»: денежные поля отчётов
// приходят только тому, кому открыты оклады и ставки.
export const formatMoney = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;

export const fullName = (person: { firstName?: string; lastName?: string }) =>
  `${person.lastName ?? ""} ${person.firstName ?? ""}`.trim();

export const initials = (person: { firstName?: string; lastName?: string }) =>
  `${person.lastName?.[0] ?? ""}${person.firstName?.[0] ?? ""}`.toUpperCase();
