import { setDocTitle } from "@/hooks/use-doc-title";
import { api } from "@/lib/api";
import { load, invalidate } from "@/store/form-data";
import { useLoaderData, useResolvedPath } from "react-router";

import DeviceBuildForm from "../../components/DeviceBuild/Form";

// «Новая сборка» — шторка карточки типа (device-types/:id/builds/add)
const AddDeviceBuildPage = () => {
  const { deviceType } = useLoaderData();
  // Крошка созданной сборки ведёт назад на карточку типа, откуда её завели.
  // `..` — родительский маршрут, то есть сама карточка.
  const ownerPath = useResolvedPath("..").pathname;

  return (
    <DeviceBuildForm
      title="Новая сборка"
      submitLabel="Создать"
      successState={
        deviceType?.name
          ? { from: { label: deviceType.name, to: ownerPath } }
          : undefined
      }
    />
  );
};

export default AddDeviceBuildPage;

export async function loader({ params }) {
  setDocTitle("Новая сборка");

  // Тип — свежий (слоты сборки); модели комплектующих — из кэша форм
  const [deviceType, models] = await Promise.all([
    api(`/api/inventory/device-types/${params.id}`),
    load("/api/inventory/device-models"),
  ]);

  return {
    deviceType: {
      _id: deviceType._id,
      name: deviceType.name,
      assembly: deviceType.assembly,
    },
    models: Array.isArray(models) ? models : [],
    build: null,
  };
}

// Тело — JSON из шторки: { name, notes, parts: [{ typeId, deviceModelId,
// configurationId, quantity }] }
export async function action({ request, params }) {
  // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
  invalidate("/api/inventory/");
  const { name, notes, parts } = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-builds/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deviceTypeId: params.id, name, notes, parts }),
    },
  );

  // Незаполненный слот, чужая модель — остаёмся в форме с сообщением сервера
  if ([400, 404].includes(response.status)) {
    const payload = await response.json().catch(() => ({}));
    return {
      error: true,
      message: payload.message || "Не удалось создать сборку.",
    };
  }
  if (!response.ok) {
    throw response;
  }
  // Созданная сборка — FormWrapper уведёт на её карточку
  return await response.json();
}
