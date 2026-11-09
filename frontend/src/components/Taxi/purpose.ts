import type { TaxiCompany, TaxiPurpose } from "@/types/taxi";

export const taxiPurposeOptions: { value: TaxiPurpose; label: string }[] = [
  { value: "service", label: "Служебная" },
  { value: "business", label: "Выезд к клиенту" },
  { value: "personal", label: "Личная" },
  { value: "unknown", label: "Не указано" },
];
export const normalizeTaxiPurpose = (value: string): TaxiPurpose =>
  value === "home"
    ? "personal"
    : taxiPurposeOptions.find((option) => option.value === value)?.value ||
      "unknown";
export const taxiPurposeLabel = (value: string) =>
  taxiPurposeOptions.find(
    (option) => option.value === normalizeTaxiPurpose(value),
  )!.label;
export const defaultTaxiPurpose = (
  companyId: string,
  companies: TaxiCompany[],
): TaxiPurpose =>
  !companyId
    ? "unknown"
    : companies.find((company) => company._id === companyId)?.isInternal
      ? "service"
      : "business";
