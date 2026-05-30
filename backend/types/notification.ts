import type { Types } from "mongoose";

export interface INotification {
  instrument?: "email" | "telegram";
  ticketId?: Types.ObjectId;
  commentId?: Types.ObjectId;
  to?: {
    chatId?: string;
    globalChat?: boolean;
    companyChat?: string;
    applicant?: string;
    responsible?: string;
    manager?: string;
    email?: string;
  };
  title?: string;
  text?: string;
  sent: boolean;
  failed: boolean;
  attemptsCounter: number;
  createdAt: Date;
  updatedAt: Date;
}
