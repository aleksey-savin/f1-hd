import { useContext } from "react";
import { useLoaderData, redirect } from "react-router";

import ViewVendor from "../../components/Vendor/View";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const ViewVendorPage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageClientDevices } = permissions;
  const { vendor, models } = useLoaderData();

  if (!canUseInventoryModule || !canManageClientDevices) {
    return <Forbidden />;
  }

  return <ViewVendor vendor={vendor} models={models} />;
};

export default ViewVendorPage;

export async function loader({ params }) {
  document.title = "Просмотр вендора";

  const { token } = getLocalStorageData();
  const headers = { Authorization: "Bearer " + token };
  const base = `${import.meta.env.VITE_API_ADDRESS}/api/inventory`;

  const vendorResponse = await fetch(`${base}/vendors/${params.id}`, {
    headers,
  });
  if (!vendorResponse.ok) {
    throw vendorResponse;
  }
  const vendor = await vendorResponse.json();

  // Отдельного «модели по вендору» эндпоинта нет — берём общий список моделей
  // и фильтруем (ср. карточку типа). getAll уже populate'ит deviceTypeId/
  // vendorId и кладёт configurationsCount + photos — ровно то, что нужно
  // строкам секции «Модели устройств».
  const modelsResponse = await fetch(`${base}/device-models`, { headers });
  const allModels = modelsResponse.ok ? await modelsResponse.json() : [];
  const models = (Array.isArray(allModels) ? allModels : []).filter(
    (model) => String(model.vendorId?._id) === String(params.id),
  );

  return { vendor, models };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  };

  const data = await request.formData();
  if (data.get("intent") !== "delete") {
    return { ok: true };
  }
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors/delete/${id}`,
    { method: "POST", headers },
  );

  // Вендора с моделями бэкенд не даёт удалить (409) — остаёмся на карточке
  // и показываем тост (см. ViewVendor).
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    return {
      error: true,
      message:
        body.message || "Вендор используется моделями — удаление невозможно.",
    };
  }
  if (!response.ok) {
    throw response;
  }
  return redirect("/inventory/vendors");
}
