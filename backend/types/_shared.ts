// Shared embedded shapes reused across multiple model interfaces.

/** Embedded file attachment (tickets, comments). */
export interface IAttachment {
  mimetype?: string;
  name?: string;
  originalName?: string;
}

/** A single day within a weekly work schedule. */
export interface IDaySchedule {
  isWorking: boolean;
  is24hours: boolean;
  start: string;
  end: string;
}

/** Weekly work schedule, embedded in Company and ServicePlan. */
export interface IWorkSchedule {
  Monday?: IDaySchedule;
  Tuesday?: IDaySchedule;
  Wednesday?: IDaySchedule;
  Thursday?: IDaySchedule;
  Friday?: IDaySchedule;
  Saturday?: IDaySchedule;
  Sunday?: IDaySchedule;
}
