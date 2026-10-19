import { setDocTitle } from "@/hooks/use-doc-title";
import { api } from "@/lib/api";
import { load, invalidate } from "@/store/form-data";
import { useLocation } from "react-router";

import DeviceBuildForm from "../../components/DeviceBuild/Form";

// «Изменить сборку» — шторка карточки сборки (device-builds/:id/update);
// после сохранения остаёмся на карточке, а её крошка — на месте: state
// перехода (from) несём обратно, иначе replace-переход его теряет
const UpdateDeviceBuildPage = () => {
  const location = useLocation();
  return (
    <DeviceBuildForm
      title="Изменить сборку"
      submitLabel="Сохранить"
      successState={location.state ?? undefined}
    />
  );
};

export default UpdateDeviceBuildPage;

export async function loader({ params }) {
  setDocTitle("Изменить сборку");

  // Сборка — всегда свежая (вместе с типом и его слотами); модели — из кэша
  const [{ build, deviceType }, models] = await Promise.all([
    api(`/api/inventory/device-builds/${params.id}`),
    load("/api/inventory/device-models"),
  ]);

  return {
    deviceType,
    models: Array.isArray(models) ? models : [],
    build,
  };
}

// Тело — JSON из шторки, как у создания (тип сборки не меняется)
export async function action({ request, params }) {
  // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
  invalidate("/api/inventory/");
  const { name, notes, parts } = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-builds/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, notes, parts }),
    },
  );

  if ([400, 404].includes(response.status)) {
    const payload = await response.json().catch(() => ({}));
    return {
      error: true,
      message: payload.message || "Не удалось сохранить сборку.",
    };
  }
  if (!response.ok) {
    throw response;
  }
  return { ok: true };
}
