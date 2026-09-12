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

export type TicketCustomFieldType =
  | "text"
  | "select"
  | "multiselect"
  | "boolean"
  | "number"
  | "date";

/**
 * Questionnaire field: the definition on a template, the definition snapshot
 * plus the answer on a ticket. Answer shape per type — services/ticketQuestionnaire.
 */
export interface ITicketCustomField {
  /** Stable id assigned by the server; answers are matched by it, not by name. */
  key?: string;
  name?: string;
  type?: TicketCustomFieldType;
  value?: unknown;
  options?: string[];
  required?: boolean;
  hint?: string;
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
  isNotified?: { telegram?: boolean; email?: boolean; inApp?: boolean };
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

export interface ITicketAiGuideSource {
  _id?: string;
  title?: string;
  type?: string;
}

export interface ITicketAiGuide {
  status?: TicketAiGuideStatus;
  kind?: TicketAiGuideKind;
  summary?: string;
  items?: ITicketAiGuideItem[];
  sources?: ITicketAiGuideSource[];
  provider?: string;
  model?: string;
  error?: string;
  startedAt?: Date;
  generatedAt?: Date;
  generatedFromCommentCount?: number;
}

export interface ITicket extends ITicketDefaultFields {
  num?: number;
  htmlDescription?: string;
  /** Description was composed by the server from questionnaire answers. */
  descriptionComposed?: boolean;
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
  /** Последнее движение заявки (событие или комментарий): когда и кто. */
  activity?: { at?: Date; by?: Types.ObjectId };
  comments?: Types.ObjectId[];
  source: TicketSource;
  responsibles?: ITicketResponsible[];
  removedFromResponsibles?: {
    _id?: Types.ObjectId;
    firstName?: string;
    lastName?: string;
    isNotified?: { telegram?: boolean; email?: boolean; inApp?: boolean };
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
