import { useContext } from "react";
import { useLoaderData, redirect } from "react-router";

import ViewDeviceType from "../../components/DeviceType/View";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const ViewDeviceTypePage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageClientDevices } = permissions;
  const { deviceType, models } = useLoaderData();

  if (!canUseInventoryModule || !canManageClientDevices) {
    return <Forbidden />;
  }

  return <ViewDeviceType deviceType={deviceType} models={models} />;
};

export default ViewDeviceTypePage;

export async function loader({ params }) {
  document.title = "Просмотр типа устройства";

  const { token } = getLocalStorageData();
  const headers = { Authorization: "Bearer " + token };
  const base = `${import.meta.env.VITE_API_ADDRESS}/api/inventory`;

  const typeResponse = await fetch(`${base}/device-types/${params.id}`, {
    headers,
  });
  if (!typeResponse.ok) {
    throw typeResponse;
  }
  const deviceType = await typeResponse.json();

  // Отдельного «модели по типу» эндпоинта нет — берём общий список моделей и
  // фильтруем по типу. getAll уже populate'ит deviceTypeId/vendorId и кладёт
  // configurationsCount + photos — ровно то, что нужно строкам секции «Модели».
  const modelsResponse = await fetch(`${base}/device-models`, { headers });
  const allModels = modelsResponse.ok ? await modelsResponse.json() : [];
  const models = (Array.isArray(allModels) ? allModels : []).filter(
    (model) => String(model.deviceTypeId?._id) === String(params.id),
  );

  return { deviceType, models };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  };
  const base = `${import.meta.env.VITE_API_ADDRESS}/api/inventory`;

  const data = await request.formData();
  const intent = data.get("intent");

  // Переупорядочивание атрибутов (fetcher с карточки)
  if (intent === "reorder") {
    const orderedIds = JSON.parse(data.get("orderedIds") || "[]");
    const response = await fetch(`${base}/device-type-attributes/reorder`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ deviceTypeId: params.id, orderedIds }),
    });
    if (!response.ok) {
      return {
        error: true,
        message: "Не удалось изменить порядок атрибутов.",
      };
    }
    return { ok: true, reordered: true };
  }

  if (intent !== "delete") {
    return { ok: true };
  }

  const id = data.get("id");

  // Диалог «Удалить» шлёт intent=delete для двух сущностей: самого типа
  // (id === текущего типа) и атрибута (иной id — открепление связки).
  if (id === params.id) {
    const response = await fetch(`${base}/device-types/delete/${id}`, {
      method: "POST",
      headers,
    });

    // Тип с привязанными моделями бэкенд не даёт удалить (409) — остаёмся на
    // карточке и показываем тост (см. ViewDeviceType).
    if (response.status === 409) {
      const body = await response.json().catch(() => ({}));
      return {
        error: true,
        message:
          body.message || "Тип используется моделями — удаление невозможно.",
      };
    }
    if (!response.ok) {
      throw response;
    }
    return redirect("/inventory/device-types");
  }

  // Открепление атрибута от типа
  const response = await fetch(`${base}/device-type-attributes/delete/${id}`, {
    method: "POST",
    headers,
  });
  if (!response.ok) {
    throw response;
  }
  return { ok: true, attributeDeleted: true };
}
