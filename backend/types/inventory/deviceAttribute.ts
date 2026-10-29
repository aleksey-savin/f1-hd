import type { Types } from "mongoose";

export type DeviceAttributeValueType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "text"
  | "date";

/** «model» — значение в конфигурации модели, «device» — у каждого устройства. */
export type DeviceAttributeScope = "model" | "device";

export interface IDeviceAttribute {
  code: string;
  name: string;
  valueType: DeviceAttributeValueType;
  scope: DeviceAttributeScope;
  unit?: string;
  /** Options for select/multiselect value types. */
  options?: { value?: string; label?: string }[];
  isActive: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
