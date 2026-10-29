import type { Types } from "mongoose";

export type ClientDeviceStatus =
  | "readyForDeployment"
  | "deployed"
  | "inRepair"
  | "decommissioned"
  | "inReserve"
  | "disposed";

export type ClientDeviceImportSource =
  | "manual"
  | "csv_import"
  | "api_import"
  | "migration";

export interface IInstalledSoftware {
  name?: string;
  version?: string;
  licenseKey?: string;
  installedDate?: Date;
}

export interface IClientDevice {
  configurationId?: Types.ObjectId;
  /** Значения атрибутов уровня устройства (deviceAttributes.js) */
  attributes?: { attributeId?: Types.ObjectId; value?: string }[];
  deviceModelId?: Types.ObjectId;
  // Сборка-шаблон «своего» ПК; только при deviceTypeId без модели.
  buildId?: Types.ObjectId | null;
  companyId?: Types.ObjectId;
  comment?: string;
  userId?: Types.ObjectId;
  locationId?: Types.ObjectId;
  serialNumber: string;
  // Purchase and warranty information
  purchasedAt?: Date;
  price?: number;
  purchaseDocument?: string;
  supplierId?: Types.ObjectId;
  warrantyExpirationDate?: Date;
  // Device status and lifecycle
  status: ClientDeviceStatus;
  // Maintenance information
  lastMaintenanceDate?: Date;
  nextMaintenanceDate?: Date;
  maintenanceInterval: number;
  // Technical specifications (IP, MAC, ОС — в attributes)
  // Сетевое имя ПК (hostname); уникально в пределах компании.
  hostname?: string;
  // Стабильный идентификатор реальной машины под агента; глобально уникален.
  machineId?: string;
  inventoryNumber?: string;
  notes?: string;
  installedSoftware?: IInstalledSoftware[];
  // Lifecycle tracking
  deploymentDate?: Date;
  retirementDate?: Date;
  expectedLifespan: number;
  // Financial information
  depreciationRate: number;
  currentValue?: number;
  // Import/migration tracking
  importSource: ClientDeviceImportSource;
  importDate?: Date;
  // Audit fields
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  // Soft delete
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
