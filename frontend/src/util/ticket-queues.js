import { businessDaysAgo } from "./format-date";

/**
 * Очереди списка заявок — канон «сводка = переключатель»: чип со счётчиком
 * отвечает на вопрос о множестве («сколько просрочено») и тем же нажатием сужает
 * список. Один каталог на стор (фильтрация и счётчики) и на ленту (подписи, тон,
 * порядок).
 *
 * Цвет несут только две очереди — те, что ждут человека («новые») и те, с
 * которыми что-то не так («просрочены»). Остальные нейтральны: цветом на экране
 * говорим максимум о трёх вещах.
 *
 * «Закрыты за 14 дней» здесь намеренно нет — это «Архив», у него свой раздел с
 * периодом, серверным поиском и постраничностью.
 */
export const TICKET_QUEUES = [
  { value: "all", label: "Все" },
  // Нейтральная: непрочитанное — не состояние заявки, а моё к ней отношение
  { value: "unread", label: "Непрочитанные" },
  { value: "new", label: "Новые", tone: "warn" },
  { value: "overdue", label: "Просрочены", tone: "bad" },
  { value: "today", label: "Дедлайн сегодня" },
  { value: "created_today", label: "Созданы сегодня" },
  { value: "i_am_applicant", label: "Созданы мной" },
];

export const DEFAULT_QUEUE = "all";

export const queueLabel = (value) =>
  TICKET_QUEUES.find((queue) => queue.value === value)?.label ?? "";

/**
 * Заявка попадает в очередь. Источник списка — «все открытые», поэтому закрытые
 * здесь не проверяем: их в наборе нет.
 *
 * «Сегодня» считается в бизнес-таймзоне (businessDaysAgo), а не в браузерной:
 * иначе у сотрудника западнее организации «сегодня» наступало бы не тогда,
 * когда у коллег.
 */
export const matchesQueue = (ticket, queue, userId) => {
  switch (queue) {
    case "unread":
      // Считает сервер: чужое движение после моего последнего визита
      return Boolean(ticket.unread?.isUnseen);
    case "new":
      return ticket.state === "Новая";
    case "overdue":
      return !!ticket.deadline && new Date(ticket.deadline) < new Date();
    case "today":
      return businessDaysAgo(ticket.deadline) === 0;
    case "created_today":
      return businessDaysAgo(ticket.createdAt) === 0;
    case "i_am_applicant":
      return ticket.applicant?._id?.toString() === userId?.toString();
    default:
      return true;
  }
};
