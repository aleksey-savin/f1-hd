import { useState } from "react";
import { useLoaderData } from "react-router";

import FormWrapper from "../../UI/FormWrapper";
import TechFields from "./TechFields";

const toDateInput = (date) => {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
};

const refId = (value) => value?._id || value || "";

/**
 * Отдельный редактор блока «Техническая информация», открывается с карточки
 * устройства. Прочие поля устройства идут скрытыми, чтобы общий update-эндпоинт
 * не затёр их при сохранении.
 */
const TechEditForm = ({ title }) => {
  const device = useLoaderData();

  const [values, setValues] = useState({
    ipAddress: device?.ipAddress || "",
    macAddress: device?.macAddress || "",
    operatingSystem: device?.operatingSystem || "",
    lastMaintenanceDate: toDateInput(device?.lastMaintenanceDate),
    notes: device?.notes || "",
  });

  const setField = (name, value) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const hidden = {
    companyId: refId(device?.companyId),
    locationId: refId(device?.locationId),
    deviceModelId: refId(device?.deviceModelId),
    serialNumber: device?.serialNumber || "",
    status: device?.status || "",
    purchasedAt: toDateInput(device?.purchasedAt),
    price: device?.price ?? "",
    purchaseDocument: device?.purchaseDocument || "",
    supplierId: refId(device?.supplierId),
    warrantyExpirationDate: toDateInput(device?.warrantyExpirationDate),
  };

  return (
    <FormWrapper title={title}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <TechFields values={values} onChange={setField} />
    </FormWrapper>
  );
};

export default TechEditForm;
