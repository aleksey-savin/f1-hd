import { addDays, format, parseISO } from "date-fns";

/** Календарные дни от day-key организации, независимо от часового пояса браузера. */
export const deferredDateAfter = (today: string, days: number): string =>
  format(addDays(parseISO(today), days), "yyyy-MM-dd");
