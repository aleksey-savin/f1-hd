import type { Types } from "mongoose";

export interface IUserPermissions {
  // tickets workflow
  canPerformTickets: boolean;
  canAdministrateTickets: boolean;
  canSeeAllCompanyTickets: boolean;
  canSeeAllTickets: boolean;
  canEditTickets: boolean;
  canDeleteTickets: boolean;
  // basic portal administration
  canManageCompanies: boolean;
  canManageUsers: boolean;
  canManageTicketCategories: boolean;
  canManageKnowledgeBase: boolean;
  canSeeKnowledgeBase: boolean;
  canManageRoutineTasks: boolean;
  canUpdateChangelog: boolean;
  canManageTicketTemplates: boolean;
  // time tracking module
  canUseTimeTrackingModule: boolean;
  canAvoidWorks: boolean;
  canSeeWorksReport: boolean;
  canSeeAnalytics: boolean;
  // inventory module
  canUseInventoryModule: boolean;
  canManageClientDevices: boolean;
  canManageDeviceModels: boolean;
  canManageDeviceTypes: boolean;
  canManageDeviceAttributes: boolean;
  canManageMikrotikDevices: boolean;
  canManageMikrotikConfigs: boolean;
  // finances module
  canUseFinancesModule: boolean;
  canManageServicePlans: boolean;
  canSeeGlobalFinancialReport: boolean;
  canConfirmReportActions: boolean;
  canSeePersonalFinancialReport: boolean;
}

export interface IUserTelegramNotify {
  newTicket: boolean;
  respStateUpdate: boolean;
  ticketStateUpdate: boolean;
  ticketDeadlineUpdate: boolean;
  ticketNewComment: boolean;
  scheduledWorks: boolean;
}

export interface IUserEmailNotify {
  newTicket: boolean;
  respStateUpdate: boolean;
  ticketStateUpdate: boolean;
  updatedDeadline: boolean;
  ticketNewComment: boolean;
  scheduledWorks: boolean;
}

// Держать синхронно с каталогом utils/workStatuses.js
export type WorkStatusCode =
  | "office"
  | "remote"
  | "trip"
  | "lunch"
  | "absent"
  | "offshift"
  | "vacation"
  | "sick"
  | "unset";

export interface IUser {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  profileImagePath?: string;
  backgroundImagePath?: string;
  position: string;
  activeDirectoryObjectGUID?: string;
  company?: { _id?: Types.ObjectId; alias?: string };
  subdivision?: Types.ObjectId;
  responsibleForCompanies?: { id?: Types.ObjectId; alias?: string }[];
  role?: string;
  categories?: { _id?: Types.ObjectId; title?: string }[];
  isAdmin: boolean;
  isEndUser: boolean;
  isServiceAccount: boolean;
  isCloudTelephony: boolean;
  hideWorkStatus?: boolean;
  permissions: IUserPermissions;
  finances?: {
    salary: number | null;
    overtimeHourlyRate: number | null;
  };
  notify: { byTelegram: IUserTelegramNotify; byEmail: IUserEmailNotify };
  password: string;
  isActive: boolean;
  lastLogin?: Date;
  verifyToken?: string;
  verifyTokenExpiration?: Date;
  resetToken?: string;
  resetTokenExpiration?: Date;
  telegramBot: { isActive: boolean; chatId: string };
  workStatus?: {
    code: WorkStatusCode;
    note: string;
    updatedAt: Date | null;
  };
  getScreen: { api: string };
  notifications?: {
    lastAction?: string;
    pending?: boolean;
    changelogUpdate?: boolean;
    resetToken?: string;
    password?: string;
  };
  darkMode?: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
