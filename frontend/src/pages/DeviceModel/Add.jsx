import { load } from "@/store/form-data";
import { useParams } from "react-router";

import Form from "../../components/DeviceModel/Form";

const AddDeviceModelPage = ({ presetFrom }) => {
  // Вложенные маршруты карточек (device-types/:id/models/add,
  // vendors/:id/models/add) — родитель известен заранее, подставим; о том,
  // кто родитель, говорит проп маршрута. На списке (device-models/add)
  // params пуст, пресета нет.
  const { id } = useParams();

  return (
    <Form
      title="Новая модель устройства"
      presetDeviceTypeId={presetFrom === "deviceType" ? id : undefined}
      presetVendorId={presetFrom === "vendor" ? id : undefined}
      // Создание → карточка созданной модели (навигация после сабмита, гайд)
      successTo={(data) =>
        data?.deviceModel?._id
          ? `/inventory/device-models/${data.deviceModel._id}`
          : undefined
      }
    />
  );
};

export default AddDeviceModelPage;

export async function loader() {
  document.title = "Новая модель устройства";

  // Справочники — из кэша (store/form-data). Тип содержит флаг isConsumable
  // (для поля «Совместимые модели»); атрибуты здесь больше не нужны —
  // конфигурации создаются отдельной формой с карточки.
  const [deviceTypes, vendors, deviceModels] = await Promise.all([
    load("/api/inventory/device-types"),
    load("/api/inventory/vendors"),
    load("/api/inventory/device-models"),
  ]);

  return {
    deviceTypes,
    vendors,
    deviceModels,
  };
}

export async function action({ request }) {
  const data = await request.formData();

  const deviceModelData = {
    deviceTypeId: data.get("deviceTypeId"),
    vendorId: data.get("vendorId"),
    name: data.get("name"),
    compatibleWithModelIds: data.getAll("compatibleWithModelIds"),
    notes: data.get("notes"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deviceModelData),
    },
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return await response.json();
}
