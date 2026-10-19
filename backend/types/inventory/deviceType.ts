import type { Types } from "mongoose";

export interface IDeviceType {
  name: string;
  isActive: boolean;
  isComponent: boolean;
  isConsumable: boolean;
  configurationIds?: Types.ObjectId[];
  attachableToTypeIds?: Types.ObjectId[];
  assembly?: {
    enabled: boolean;
    slots: { typeId: Types.ObjectId; required: boolean; multiple: boolean }[];
    keySpecs: {
      typeId: Types.ObjectId;
      source: "model" | "attribute";
      attributeId: Types.ObjectId | null;
      aggregate: "first" | "sum" | "list";
    }[];
  };
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
