import type { Types } from "mongoose";

export type LocationType =
  | "building"
  | "floor"
  | "room"
  | "workplace"
  | "storage";

export type ResponsibilityType = "user" | "manager" | "it_admin" | "custom";

export interface ILocationResponsibilityRules {
  deviceTypeOverrides?: {
    deviceType?: Types.ObjectId;
    responsibleUser?: Types.ObjectId;
    responsibilityType?: ResponsibilityType;
  }[];
  inheritFromParent: boolean;
}

export interface ILocation {
  name: string;
  type: LocationType;
  description?: string;
  // Hierarchical structure
  parent?: Types.ObjectId;
  children?: Types.ObjectId[];
  // Company and subdivision references
  company: Types.ObjectId;
  subdivisions?: Types.ObjectId[];
  // Physical details
  address?: string;
  coordinates?: { x?: number; y?: number; floor?: number; room?: string };
  capacity?: number;
  // For workplace type
  assignedUser?: Types.ObjectId;
  // Responsibility management
  defaultResponsible?: Types.ObjectId;
  responsibilityRules?: ILocationResponsibilityRules;
  // Status and metadata
  isActive: boolean;
  isAccessible: boolean;
  isPublic: boolean;
  // Additional metadata
  tags?: string[];
  notes?: string;
  // Audit fields
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
