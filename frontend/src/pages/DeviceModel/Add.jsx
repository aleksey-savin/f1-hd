import { setDocTitle } from "@/hooks/use-doc-title";
import { load, invalidate } from "@/store/form-data";
import { useLoaderData, useParams, useResolvedPath } from "react-router";

import Form from "../../components/DeviceModel/Form";

const AddDeviceModelPage = ({ presetFrom }) => {
  // Вложенные маршруты карточек (device-types/:id/models/add,
  // vendors/:id/models/add) — родитель известен заранее, подставим; о том,
  // кто родитель, говорит проп маршрута. На списке (device-models/add)
  // params пуст, пресета нет.
  const { id } = useParams();
  const { deviceTypes, vendors } = useLoaderData();
  // Крошка созданной модели ведёт назад на карточку типа/вендора, откуда её
  // завели (как у ссылок на модели с этих карточек), а не в «Модели».
  // `..` — родительский маршрут, то есть сама карточка.
  const ownerPath = useResolvedPath("..").pathname;
  const owner =
    presetFrom === "deviceType"
      ? deviceTypes?.find((type) => type._id === id)
      : presetFrom === "vendor"
        ? vendors?.find((vendor) => vendor._id === id)
        : null;

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
      successState={
        owner?.name
          ? { from: { label: owner.name, to: ownerPath } }
          : undefined
      }
    />
  );
};

export default AddDeviceModelPage;

export async function loader() {
  setDocTitle("Новая модель устройства");

  // Справочники — из кэша (store/form-data). Тип содержит флаг isConsumable
  // (для поля «Совместимые модели»); атрибуты типа поля характеристик грузят
  // сами — по выбранному в форме типу.
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
