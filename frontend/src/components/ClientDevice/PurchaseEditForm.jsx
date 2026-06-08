import { useState, useEffect } from "react";
import { useLoaderData } from "react-router";

import FormWrapper from "../../UI/FormWrapper";
import PurchaseFields from "./PurchaseFields";
import { getLocalStorageData } from "../../util/auth";

const toDateInput = (date) => {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
};

const refId = (value) => value?._id || value || "";

/**
 * Отдельный редактор блока «Покупка», открывается с карточки устройства.
 * Редактируемые поля рендерит PurchaseFields; остальные поля устройства идут
 * скрытыми, чтобы общий update-эндпоинт не затёр их при сохранении.
 */
const PurchaseEditForm = ({ title }) => {
  const device = useLoaderData();

  const [values, setValues] = useState({
    purchasedAt: toDateInput(device?.purchasedAt),
    price: device?.price ?? "",
    purchaseDocument: device?.purchaseDocument || "",
    supplierId: refId(device?.supplierId),
    warrantyExpirationDate: toDateInput(device?.warrantyExpirationDate),
  });
  const [suppliers, setSuppliers] = useState([]);

  useEffect(() => {
    const fetchSuppliers = async () => {
      const { token } = getLocalStorageData();
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers`,
          { headers: { Authorization: "Bearer " + token } },
        );
        const data = await response.json();
        setSuppliers(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error fetching suppliers:", error);
      }
    };
    fetchSuppliers();
  }, []);

  const setField = (name, value) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const handleSupplierCreated = (supplier) =>
    setSuppliers((prev) => [...prev, supplier]);

  // Остальные поля устройства — скрытыми, чтобы не потерять при обновлении.
  const hidden = {
    companyId: refId(device?.companyId),
    locationId: refId(device?.locationId),
    deviceModelId: refId(device?.deviceModelId),
    serialNumber: device?.serialNumber || "",
    status: device?.status || "",
    ipAddress: device?.ipAddress || "",
    macAddress: device?.macAddress || "",
    operatingSystem: device?.operatingSystem || "",
    lastMaintenanceDate: toDateInput(device?.lastMaintenanceDate),
    notes: device?.notes || "",
  };

  return (
    <FormWrapper title={title}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <PurchaseFields
        values={values}
        onChange={setField}
        suppliers={suppliers}
        onSupplierCreated={handleSupplierCreated}
      />
    </FormWrapper>
  );
};

export default PurchaseEditForm;
