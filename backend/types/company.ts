import type { Types } from "mongoose";
import type { IWorkSchedule } from "./_shared";

/** Denormalized user reference stored on a company. */
export interface ICompanyUserRef {
  id?: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  position?: string;
  role?: string;
  isActive?: boolean;
}

export interface ICompanyApiKey {
  key: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  createdBy?: Types.ObjectId;
}

export interface ICompany {
  alias: string;
  fullTitle: string;
  profileImagePath?: string;
  emailDomains?: string[];
  phones?: string[];
  address?: string;
  linkToMap?: string;
  subdivisions?: Types.ObjectId[];
  users?: ICompanyUserRef[];
  employees?: Types.ObjectId[];
  responsibles?: ICompanyUserRef[];
  clientsSideResponsibles?: ICompanyUserRef[];
  locationSettings?: {
    allowTracking?: boolean;
    latitude?: number;
    longitude?: number;
    title?: string;
    radius?: number;
  };
  workSchedule?: IWorkSchedule;
  servicePlans?: {
    _id?: Types.ObjectId;
    isActiveSince?: Date;
    customerApprovalRequired?: boolean;
  }[];
  apiKeys?: ICompanyApiKey[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
