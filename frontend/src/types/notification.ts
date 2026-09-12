/** Категория уведомления — ключ, общий с настройками (prefs.notify.personal, user.notify.*) */
export type NotificationCategory =
  | "newTicket"
  | "respStateUpdate"
  | "ticketStateUpdate"
  | "ticketDeadlineUpdate"
  | "ticketNewComment"
  | "scheduledWorks"
  | "absenceRequest"
  | "absenceDecision"
  | "reportApproval"
  | "reportDecision";

/** Вид события: каталог хроники (util/ticket-events) плюс события вне заявок */
export type NotificationKind =
  | "created"
  | "processed"
  | "taken"
  | "takenOver"
  | "joined"
  | "helpRequested"
  | "deadline"
  | "updated"
  | "workAdded"
  | "workUpdated"
  | "checklist"
  | "attachmentAdded"
  | "attachmentRemoved"
  | "rejected"
  | "closed"
  | "reopened"
  | "comment"
  | "delivery"
  | "ai"
  | "other"
  | "absenceRequest"
  | "absenceDecision"
  | "reportApproval"
  | "reportDecision";

export type NotificationActor = {
  _id: string;
  firstName?: string;
  lastName?: string;
};

/** Строка колокольчика так, как её отдаёт `GET /api/notifications` */
export type NotificationItem = {
  _id: string;
  category: NotificationCategory;
  kind: NotificationKind;
  ticketId: string | null;
  ticketNum: number | null;
  ticketTitle: string;
  commentId: string | null;
  actor: NotificationActor | null;
  title: string;
  text: string;
  /** Относительный маршрут, куда ведёт строка */
  link: string;
  readAt: string | null;
  createdAt: string;
};

export type NotificationsListResponse = {
  items: NotificationItem[];
  unreadCount: number;
  /** Курсор следующей страницы — createdAt последней строки; null — конец */
  nextBefore: string | null;
};

export type NotificationsSummary = {
  unreadCount: number;
  latestAt: string | null;
};

export type NotificationsReadResponse = {
  updated: number;
  unreadCount: number;
};

/** Ответ `POST /api/tickets/:num/seen` */
export type TicketSeenResponse = {
  seenAt: string;
  previousSeenAt: string | null;
  unreadCount: number;
};

/** Непрочитанное по заявке в строке списка (считает сервер, services/ticketUnread) */
export type TicketUnread = {
  isUnseen: boolean;
  newComments: number;
};
