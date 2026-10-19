import { setDocTitle } from "@/hooks/use-doc-title";
import { api } from "@/lib/api";
import { load, invalidate } from "@/store/form-data";
import Form from "../../components/DeviceType/Form";

const UpdateDeviceTypePage = () => {
  return <Form title="Изменить тип устройства" />;
};

export default UpdateDeviceTypePage;

export async function loader({ params }) {
  setDocTitle("Изменить тип устройства");

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
  // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
  invalidate("/api/inventory/");
  const data = await request.formData();

  const deviceTypeData = {
    name: data.get("name"),
    isActive: data.get("isActive") === "true",
    isComponent: data.get("isComponent") === "true",
    isConsumable: data.get("isConsumable") === "true",
    isPeripheral: data.get("isPeripheral") === "true",
    inventoryPrefix: data.get("inventoryPrefix"),
    attachableToTypeIds: data.getAll("attachableToTypeIds"),
    // Настоящий boolean: иное сервер молча пропускает
    assemblyEnabled: data.get("assemblyEnabled") === "true",
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

  // Конфликт (имя занято; «Своя сборка» не выключается, пока есть сборки) —
  // остаёмся в форме с сообщением сервера (FormWrapper покажет)
  if ([409].includes(response.status)) {
    const payload = await response.json().catch(() => ({}));
    return {
      error: true,
      message: payload.message || "Не удалось сохранить тип устройства.",
    };
  }

  if (!response.ok) {
    throw response;
  }

  return await response.json();
}
