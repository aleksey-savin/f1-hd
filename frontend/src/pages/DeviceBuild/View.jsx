import { setDocTitle } from "@/hooks/use-doc-title";
import { useLoaderData, redirect } from "react-router";

import ViewDeviceBuild from "../../components/DeviceBuild/View";
import { invalidate } from "@/store/form-data";

const ViewDeviceBuildPage = () => {
  const { build, deviceType, partLinks } = useLoaderData();

  return (
    <ViewDeviceBuild
      build={build}
      deviceType={deviceType}
      partLinks={partLinks}
    />
  );
};

export default ViewDeviceBuildPage;

export async function loader({ params }) {
  setDocTitle("Просмотр сборки");

  // Сборка с деталями (модели, конфигурации — populate), тип со слотами и
  // ключевыми характеристиками, связки типов деталей с группами атрибутов
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-builds/${params.id}`,
  );
  if (!response.ok) {
    throw response;
  }
  const { build, deviceType, partLinks } = await response.json();

  return { build, deviceType, partLinks: partLinks || {} };
}

export async function action({ request, params }) {
  // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
  invalidate("/api/inventory/");
  const base = `${import.meta.env.VITE_API_ADDRESS}/api/inventory`;

  const data = await request.formData();
  if (data.get("intent") !== "delete") {
    return { ok: true };
  }

  // Тип сборки — куда вернуться после удаления (карточка типа)
  const current = await fetch(`${base}/device-builds/${params.id}`);
  const typeId = current.ok
    ? (await current.json()).build?.deviceTypeId
    : null;

  const response = await fetch(`${base}/device-builds/delete/${params.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw response;
  }

  return redirect(
    typeId ? `/inventory/device-types/${typeId}` : "/inventory/device-types",
  );
}
