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
  /** Точка из linkToMap (services/mapLink) — маршрут такси и «Открыть на карте». */
  location?: {
    lat?: number;
    lon?: number;
  };
  locationSettings?: {
    allowTracking?: boolean;
    latitude?: number;
    longitude?: number;
    title?: string;
    radius?: number;
  };
  workSchedule?: IWorkSchedule;
  /** IANA-зона клиента; null — берётся Preferences.timezone. */
  timezone?: string | null;
  servicePlans?: {
    _id?: Types.ObjectId;
    isActiveSince?: Date;
    customerApprovalRequired?: boolean;
    /** Кто подписывает отчёт со стороны клиента — снапшот имени. */
    approver?: { _id: string; firstName?: string; lastName?: string } | null;
    /** Отчёт делится по филиалам, каждую часть подписывает их руководитель. */
    subdivisionApprovalRequired?: boolean;
  }[];
  apiKeys?: ICompanyApiKey[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
