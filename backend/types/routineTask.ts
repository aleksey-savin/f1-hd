import type { Types } from "mongoose";

export interface IRoutineTask {
  title: string;
  description?: string;
  company: { _id: Types.ObjectId; alias: string };
  applicant: { _id: Types.ObjectId; firstName: string; lastName?: string };
  category: { _id: Types.ObjectId; title: string };
  isActive: boolean;
  cronSchedule?: string;
  checklist?: { description?: string; checked?: boolean }[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
