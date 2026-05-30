import type { Types } from "mongoose";

export interface IDeviceType {
  name: string;
  isActive: boolean;
  isComponent: boolean;
  isConsumable: boolean;
  configurationIds?: Types.ObjectId[];
  attachableToTypeIds?: Types.ObjectId[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
