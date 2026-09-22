import type {
  NotificationCategory,
  UnreadByCategory,
} from "@/types/notification";

/**
 * Фасеты панели уведомлений: десять категорий настроек сведены в шесть
 * понятных слов (макет «Уведомления: фильтр по виду»). Ключ фасета — значение
 * чипа и localStorage, категории — параметр `category` ручки списка и
 * `categories` у «прочитать все».
 */
export type NotificationFacet = {
  key: string;
  label: string;
  /** Пусто — «Все», фильтра нет */
  categories: NotificationCategory[];
};

export const NOTIFICATION_FACETS: NotificationFacet[] = [
  { key: "all", label: "Все", categories: [] },
  { key: "new", label: "Новые заявки", categories: ["newTicket"] },
  // Статус заявки и ответственного — для читателя одно: «что с заявкой»
  {
    key: "status",
    label: "Статусы",
    categories: ["ticketStateUpdate", "respStateUpdate"],
  },
  { key: "comment", label: "Комментарии", categories: ["ticketNewComment"] },
  { key: "deadline", label: "Сроки", categories: ["ticketDeadlineUpdate"] },
  { key: "works", label: "Работы", categories: ["scheduledWorks"] },
  {
    key: "approval",
    label: "Согласования",
    categories: [
      "absenceRequest",
      "absenceDecision",
      "reportApproval",
      "reportDecision",
    ],
  },
];

export const facetByKey = (key: string | null | undefined): NotificationFacet =>
  NOTIFICATION_FACETS.find((facet) => facet.key === key) ??
  NOTIFICATION_FACETS[0];

/** Категории для сервера; null — без фильтра */
export const facetCategories = (
  key: string | null | undefined,
): NotificationCategory[] | null => {
  const { categories } = facetByKey(key);
  return categories.length ? categories : null;
};

export const unreadInFacet = (
  byCategory: UnreadByCategory | null | undefined,
  key: string,
): number => {
  if (!byCategory) return 0;
  const categories = facetCategories(key);
  const keys = categories ?? (Object.keys(byCategory) as NotificationCategory[]);
  return keys.reduce((sum, category) => sum + (byCategory[category] ?? 0), 0);
};

/** «Прочитать все» при фильтре читает только показанный вид — и говорит это */
export const readAllLabel = (key: string): string => {
  const facet = facetByKey(key);
  return facet.key === "all"
    ? "Прочитать все"
    : `Прочитать ${facet.label.toLowerCase()}`;
};
