import type { Types } from "mongoose";

export interface IDeviceBuildPart {
  typeId: Types.ObjectId;
  deviceModelId: Types.ObjectId;
  configurationId?: Types.ObjectId | null;
  quantity: number;
}

export interface IDeviceBuild {
  name: string;
  deviceTypeId: Types.ObjectId;
  parts: IDeviceBuildPart[];
  notes?: string;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
