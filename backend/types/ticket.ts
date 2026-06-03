import type { Types } from "mongoose";
import type { IAttachment } from "./_shared";

export type TicketImpact = "Низкое" | "Среднее" | "Высокое";
export type TicketUrgency = "Низкая" | "Средняя" | "Высокая";
export type TicketPriority =
  | "Планируемый"
  | "Низкий"
  | "Средний"
  | "Высокий"
  | "Критический";
export type TicketState =
  | "Новая"
  | "Не в работе"
  | "В работе"
  | "На согласовании"
  | "Выполнена"
  | "Закрыта";
export type TicketSource =
  | "Портал"
  | "Почта"
  | "Облачная телефония"
  | "Telegram"
  | "Регламентное задание"
  | "Другое";
export type TicketNotificationAction =
  | "new ticket"
  | "process ticket"
  | "take ticket to work"
  | "request help"
  | "join responsibles"
  | "update deadline"
  | "reject ticket"
  | "close ticket"
  | "back to work";

export interface ITicketCustomField {
  name?: string;
  type?: "text" | "select" | "multiselect";
  value?: unknown;
  options?: string[];
}

/** Fields shared by Ticket and TicketTemplate (ticketDefaultFieldsSchema). */
export interface ITicketDefaultFields {
  title?: string;
  description?: string;
  categoryId?: Types.ObjectId;
  company?: { _id?: Types.ObjectId; alias?: string };
  customFields?: ITicketCustomField[];
  impact?: TicketImpact;
  urgency?: TicketUrgency;
  priority?: TicketPriority;
}

export interface ITicketResponsible {
  _id?: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  position?: string;
  role?: string;
  isActive?: boolean;
  isNotified?: { telegram?: boolean; email?: boolean };
}

export interface ITicketChecklistItem {
  description?: string;
  mandatory?: boolean;
  checked?: boolean;
  checkedBy?: { _id?: Types.ObjectId; firstName?: string; lastName?: string };
}

export type TicketAiGuideStatus = "idle" | "pending" | "ready" | "error";
export type TicketAiGuideKind = "solution" | "questions";

export interface ITicketAiGuideItem {
  text?: string;
  done?: boolean;
}

export interface ITicketAiGuide {
  status?: TicketAiGuideStatus;
  kind?: TicketAiGuideKind;
  summary?: string;
  items?: ITicketAiGuideItem[];
  provider?: string;
  model?: string;
  error?: string;
  generatedAt?: Date;
  generatedFromCommentCount?: number;
}

export interface ITicket extends ITicketDefaultFields {
  num?: number;
  htmlDescription?: string;
  attachments?: IAttachment[];
  template?: Types.ObjectId;
  routineTask?: Types.ObjectId;
  isClosed: boolean;
  realSender?: string;
  applicantId?: Types.ObjectId;
  /** @deprecated legacy, removed after 1.8.9 */
  applicant?: {
    _id?: Types.ObjectId;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    position?: string;
    role?: string;
    isActive?: boolean;
  };
  state: TicketState;
  notifications?: {
    lastAction?: TicketNotificationAction;
    pending?: boolean;
    destination?: Types.ObjectId;
  };
  comments?: Types.ObjectId[];
  source: TicketSource;
  responsibles?: ITicketResponsible[];
  removedFromResponsibles?: {
    _id?: Types.ObjectId;
    firstName?: string;
    lastName?: string;
    isNotified?: { telegram?: boolean; email?: boolean };
  }[];
  rejected?: { by?: Types.ObjectId; reason?: string }[];
  closingComment?: string;
  returningComment?: string;
  deadline?: Date;
  checklist?: ITicketChecklistItem[];
  aiGuide?: ITicketAiGuide;
  isArchived: boolean;
  processedAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  processedBy?: Types.ObjectId;
  startedBy?: Types.ObjectId;
  finishedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
