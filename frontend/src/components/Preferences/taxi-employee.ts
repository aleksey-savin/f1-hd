import type { TaxiEmployee } from "@/types/taxi";

export const taxiEmployeeName = (employee: TaxiEmployee) =>
  employee.fullName?.trim() ||
  [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() ||
  employee.email?.trim() ||
  employee.nickname?.trim() ||
  "Имя не указано";
