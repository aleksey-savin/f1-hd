import type { Types } from "mongoose";

export interface IAttributeGroup {
  name: string;
  order: number;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
