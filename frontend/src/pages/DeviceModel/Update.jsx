import { setDocTitle } from "@/hooks/use-doc-title";
import { api } from "@/lib/api";
import { load, invalidate } from "@/store/form-data";
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
  setDocTitle("Изменить модель устройства");

  // Модель и её конфигурации — всегда свежие; справочники — из кэша
  // (store/form-data). Атрибуты типа поля характеристик грузят сами — по
  // выбранному в форме типу; тип по-прежнему несёт isConsumable.
  const [deviceModel, deviceTypes, vendors, allDeviceModels, configurations] =
    await Promise.all([
      api(`/api/inventory/device-models/${params.id}`),
      load("/api/inventory/device-types"),
      load("/api/inventory/vendors"),
      load("/api/inventory/device-models"),
      // Характеристики модели — значения её первой конфигурации
      api(`/api/inventory/device-configurations/model/${params.id}`),
    ]);
  // Совместимые модели — без самой себя
  const deviceModels = allDeviceModels.filter((dm) => dm._id !== params.id);

  return {
    deviceModel,
    deviceTypes,
    vendors,
    deviceModels,
    configurations,
  };
}

export async function action({ request, params }) {
  // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
  invalidate("/api/inventory/");
  const data = await request.formData();

  const deviceModelData = {
    deviceTypeId: data.get("deviceTypeId"),
    vendorId: data.get("vendorId"),
    name: data.get("name"),
    compatibleWithModelIds: data.getAll("compatibleWithModelIds"),
    notes: data.get("notes"),
    // Характеристики (первая конфигурация) и режим «Несколько конфигураций»
    values: JSON.parse(data.get("values") || "[]"),
    multiConfig: data.get("multiConfig") === "true",
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
