import type { Types } from "mongoose";

export type DeviceAttributeValueType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "text";

export interface IDeviceAttribute {
  code: string;
  name: string;
  valueType: DeviceAttributeValueType;
  unit?: string;
  /** Options for select/multiselect value types. */
  options?: { value?: string; label?: string }[];
  isActive: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
