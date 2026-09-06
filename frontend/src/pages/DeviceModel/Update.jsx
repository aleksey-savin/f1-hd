import { api } from "@/lib/api";
import { load } from "@/store/form-data";
import DeviceModelForm from "../../components/DeviceModel/Form";
import { useSearchParams } from "react-router";

const UpdateDeviceModelPage = () => {
  const [searchParams] = useSearchParams();
  const configId = searchParams.get("configId");

  return <DeviceModelForm
          title="Изменить модель устройства"
          editConfigId={configId}
        />;
};

export default UpdateDeviceModelPage;

export async function loader({ params }) {
  document.title = "Изменить модель устройства";

  // Модель — всегда свежая; справочники — из кэша (store/form-data).
  // Атрибуты типа форме модели больше не нужны (конфигурации — отдельная
  // форма с карточки); тип по-прежнему несёт isConsumable для совместимости.
  const [deviceModel, deviceTypes, vendors, allDeviceModels] =
    await Promise.all([
      api(`/api/inventory/device-models/${params.id}`),
      load("/api/inventory/device-types"),
      load("/api/inventory/vendors"),
      load("/api/inventory/device-models"),
    ]);
  // Совместимые модели — без самой себя
  const deviceModels = allDeviceModels.filter((dm) => dm._id !== params.id);

  return {
    deviceModel,
    deviceTypes,
    vendors,
    deviceModels,
  };
}

export async function action({ request, params }) {
  const data = await request.formData();

  const deviceModelData = {
    deviceTypeId: data.get("deviceTypeId"),
    vendorId: data.get("vendorId"),
    name: data.get("name"),
    compatibleWithModelIds: data.getAll("compatibleWithModelIds"),
    notes: data.get("notes"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/update/${params.id}`,
    {
      method: "PUT",
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
