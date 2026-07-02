import { getLocalStorageData } from "../../util/auth";
import { STATUS_LABELS } from "./constants";

const base = import.meta.env.VITE_API_ADDRESS;

// Свободные устройства, которые можно прикрепить к сборке как комплектующие.
// hostTypeId (тип хоста) учитывается при ограничении attachableToTypeIds.
export async function fetchAttachableDevices({
  companyId,
  excludeId,
  hostTypeId,
}) {
  if (!companyId) return [];
  const { token } = getLocalStorageData();
  const params = new URLSearchParams({ companyId });
  if (excludeId) params.set("excludeId", excludeId);
  if (hostTypeId) params.set("hostTypeId", hostTypeId);

  try {
    const res = await fetch(
      `${base}/api/inventory/client-devices/attachable?${params.toString()}`,
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error fetching attachable devices:", error);
    return [];
  }
}

// Человекочитаемое описание устройства-комплектующего (для пикера и строк состава).
export function describeDevice(d = {}) {
  const typeName =
    d.deviceModelId?.deviceTypeId?.name || d.deviceTypeId?.name || "";
  const vendorModel = [d.deviceModelId?.vendorId?.name, d.deviceModelId?.name]
    .filter(Boolean)
    .join(" ");
  const ident =
    d.inventoryNumber || (d.serialNumber ? `SN ${d.serialNumber}` : "");
  const title =
    [typeName, vendorModel].filter(Boolean).join(" · ") || ident || "Устройство";
  const statusLabel = STATUS_LABELS[d.status] || d.status || "";

  return {
    typeName,
    vendorModel,
    serialNumber: d.serialNumber || "",
    inventoryNumber: d.inventoryNumber || "",
    quantity: d.quantity ?? 1,
    warrantyExpirationDate: d.warrantyExpirationDate || "",
    status: d.status || "",
    statusLabel,
    title,
    // Метка для option в Select: идент + статус, чтобы различать одинаковые модели.
    optionLabel:
      [title, ident].filter(Boolean).join(" · ") +
      (statusLabel ? ` (${statusLabel})` : ""),
  };
}
