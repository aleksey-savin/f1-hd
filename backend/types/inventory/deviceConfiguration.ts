import type { Types } from "mongoose";

export interface IDeviceConfiguration {
  name?: string;
  description?: string;
  deviceTypeId: Types.ObjectId;
  values?: { attributeId?: Types.ObjectId; value?: string }[];
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
