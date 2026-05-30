import type { Types } from "mongoose";

export interface ICompanyLog {
  companyId: Types.ObjectId;
  userId?: Types.ObjectId | null;
  activeDirectoryObjectGUID: string;
  activeDirectoryLogin: string;
  computerName?: string;
  action: "userLogin";
  createdAt: Date;
  updatedAt: Date;
}
