import type { Types } from "mongoose";

// NOTE: models/inventory/deviceConfigurationRecommendation.js currently registers
// this model with the wrong schema variable (`deviceAttributeSchema`) on line 35 —
// a latent bug. This interface reflects the *intended* schema
// (deviceConfigurationRecommendationSchema).
export interface IDeviceConfigurationRecommendation {
  deviceConfigurationId: Types.ObjectId;
  companyId?: Types.ObjectId;
  comment?: string;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
