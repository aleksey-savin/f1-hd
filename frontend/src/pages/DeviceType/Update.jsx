import { api } from "@/lib/api";
import { load } from "@/store/form-data";
import Form from "../../components/DeviceType/Form";

const UpdateDeviceTypePage = () => {
  return <Form title="Изменить тип устройства" />;
};

export default UpdateDeviceTypePage;

export async function loader({ params }) {
  document.title = "Изменить тип устройства";

  // Тип — всегда свежий; список всех типов для attachableToTypeIds — из кэша
  const [deviceType, allDeviceTypes] = await Promise.all([
    api(`/api/inventory/device-types/${params.id}`),
    load("/api/inventory/device-types"),
  ]);

  // Filter out current device type from available options
  const availableDeviceTypes = allDeviceTypes.filter(
    (dt) => dt._id !== params.id,
  );

  // Атрибуты в форму типа больше не входят — их правят с карточки типа.
  return { deviceType, availableDeviceTypes };
}

export async function action({ request, params }) {
  const data = await request.formData();

  const deviceTypeData = {
    name: data.get("name"),
    isActive: data.get("isActive") === "true",
    isComponent: data.get("isComponent") === "true",
    isConsumable: data.get("isConsumable") === "true",
    isPeripheral: data.get("isPeripheral") === "true",
    inventoryPrefix: data.get("inventoryPrefix"),
    attachableToTypeIds: data.getAll("attachableToTypeIds"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deviceTypeData),
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
