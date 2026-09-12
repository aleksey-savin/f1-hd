import type { Types } from "mongoose";

/** Категория уведомления — ключ, общий с prefs.notify.personal и user.notify.* */
export type InAppNotificationCategory =
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

/** Вид события: каталог хроники (services/ticketEvents) плюс события вне заявок */
export type InAppNotificationKind =
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

export interface IInAppNotificationActor {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
}

export interface IInAppNotification {
  userId: Types.ObjectId;
  category: InAppNotificationCategory;
  kind: InAppNotificationKind;
  ticketId: Types.ObjectId | null;
  ticketNum: number | null;
  ticketTitle: string;
  commentId: Types.ObjectId | null;
  actor: IInAppNotificationActor | null;
  title: string;
  text: string;
  link: string;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
