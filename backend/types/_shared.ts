// Shared embedded shapes reused across multiple model interfaces.

/** Embedded file attachment (tickets, comments). */
export interface IAttachment {
  mimetype?: string;
  mimeType?: string;
  name?: string;
  originalName?: string;
  size?: number;
  speechToText?: {
    status?: "idle" | "pending" | "ready" | "error";
    text?: string;
    summary?: string;
    segments?: {
      speaker?: string;
      text?: string;
      start?: number;
      end?: number;
    }[];
    model?: string;
    error?: string;
    generatedAt?: Date;
  };
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
