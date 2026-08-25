import type { Types } from "mongoose";

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
  /** Подтверждён ли адрес. Существующим проставлено true миграцией. */
  emailVerified: boolean;
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
  /**
   * До миграции — текстовый ярлык («Клиент» у 376, пусто у 325, одна осмысленная
   * запись). На этапе 4 становится списком кодов ролей доступа через запятую:
   * это родное поле плагина `admin`, и из него же читается каталог `Role`.
   */
  role?: string;
  categories?: { _id?: Types.ObjectId; title?: string }[];
  isAdmin: boolean;
  isEndUser: boolean;
  isServiceAccount: boolean;
  isCloudTelephony: boolean;
  hideWorkStatus?: boolean;
  finances?: {
    salary: number | null;
    overtimeHourlyRate: number | null;
  };
  notify: { byTelegram: IUserTelegramNotify; byEmail: IUserEmailNotify };
  /** Может отсутствовать: заведённый приглашением задаёт пароль сам. */
  password?: string;
  /** Ставится плагином twoFactor better-auth. */
  twoFactorEnabled: boolean;
  /**
   * Отключение учётки (плагин `admin` better-auth). Полярность ОБРАТНАЯ
   * остальным сущностям: `true` значит «не работает», а отсутствие поля —
   * «работает». Отсюда фильтры `{ banned: { $ne: true } }`.
   */
  banned: boolean;
  /** Видит только администратор в карточке; человеку не показывается. */
  banReason?: string;
  /** Пусто = бессрочно. Просроченный бан плагин снимает сам при входе. */
  banExpires?: Date;
  lastLogin?: Date;
  /** Когда отправлено приглашение. Пусто + пустой lastLogin = «не дошло». */
  invitedAt?: Date;
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
    resetToken?: string;
    password?: string;
  };
  darkMode?: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
