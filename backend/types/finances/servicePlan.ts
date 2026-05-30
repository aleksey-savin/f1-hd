import type { Types } from "mongoose";
import type { IWorkSchedule } from "../_shared";

export type ServicePlanType = "hourPackage" | "fixedPrice" | "hourly";
export type NonWorkingCalcMethod = "separatePayment" | "coefficient";

export interface IServicePlanPackage {
  hours: number;
  pricePerHour: number;
}

/** @deprecated legacy tariffing structure, superseded by top-level fields */
export interface IServicePlanLegacyTariffing {
  period?: number;
  type?: ServicePlanType;
  hourPackage?: {
    packages?: IServicePlanPackage[];
    nonWorkingTime?: {
      type?: NonWorkingCalcMethod;
      pricePerHour?: number;
      coefficient?: number;
    };
  };
  fixedPrice?: { price?: number; pricePerHourNonWorking?: number };
  hourly?: { pricePerHour?: number; pricePerHourNonWorking?: number };
}

export interface IServicePlan {
  title: string;
  companyWorkSchedule: boolean;
  customProvisionSchedule?: IWorkSchedule;
  ticketCategories?: { _id?: Types.ObjectId; title?: string }[];
  companies?: { _id?: Types.ObjectId; alias?: string }[];
  type: ServicePlanType;
  hourPackages?: IServicePlanPackage[];
  fixedPrice?: number;
  pricePerHour?: number;
  pricePerHourNonWorking?: number;
  packagesNonWorkingCalcMethod?: NonWorkingCalcMethod;
  packagesNonWorkingCoefficient?: number;
  tariffingPeriod?: number;
  tariffing?: IServicePlanLegacyTariffing;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
