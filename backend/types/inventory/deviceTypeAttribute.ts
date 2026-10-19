import type { Types } from "mongoose";

export interface IDeviceTypeAttribute {
  deviceTypeId: Types.ObjectId;
  attributeId: Types.ObjectId;
  groupId?: Types.ObjectId | null;
  required: boolean;
  extendable: boolean;
  extendableFromIds?: { deviceTypeId: Types.ObjectId }[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
