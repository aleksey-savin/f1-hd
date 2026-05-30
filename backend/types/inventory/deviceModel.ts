import type { Types } from "mongoose";

export interface IDeviceModel {
  name?: string;
  deviceTypeId: Types.ObjectId;
  vendorId: Types.ObjectId;
  compatibleWithModelIds?: Types.ObjectId[];
  notes?: string;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
