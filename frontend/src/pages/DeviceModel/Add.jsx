import { useParams } from "react-router";

import Form from "../../components/DeviceModel/Form";
import { getLocalStorageData } from "../../util/auth";

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
  document.title = "Добавить модель устройства";

  const { token } = getLocalStorageData();

  // Fetch device types with attributes
  const deviceTypesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );
  // Тип содержит флаг isConsumable (для поля «Совместимые модели»); атрибуты
  // здесь больше не нужны — конфигурации создаются отдельной формой с карточки.
  const deviceTypes = await deviceTypesResponse.json();

  // Fetch vendors
  const vendorsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );
  const vendors = await vendorsResponse.json();

  // Fetch all device models for compatibility selection
  const deviceModelsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );
  const deviceModels = await deviceModelsResponse.json();

  return {
    deviceTypes,
    vendors,
    deviceModels,
  };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

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
        Authorization: "Bearer " + token,
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
