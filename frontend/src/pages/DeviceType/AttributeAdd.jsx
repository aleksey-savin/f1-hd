import { useContext } from "react";

import AttributeForm from "../../components/DeviceType/AttributeForm";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const AttributeAddPage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageClientDevices } = permissions;

  if (!canUseInventoryModule || !canManageClientDevices) {
    return <Forbidden />;
  }
  return <AttributeForm title="Добавить атрибут" />;
};

export default AttributeAddPage;

export async function loader({ params }) {
  document.title = "Добавить атрибут типа";

  const { token } = getLocalStorageData();
  const headers = { Authorization: "Bearer " + token };
  const base = `${import.meta.env.VITE_API_ADDRESS}/api/inventory`;

  const [typeResponse, catalogResponse] = await Promise.all([
    fetch(`${base}/device-types/${params.id}`, { headers }),
    fetch(`${base}/device-attributes`, { headers }),
  ]);
  if (!typeResponse.ok) {
    throw typeResponse;
  }
  const deviceType = await typeResponse.json();
  const catalog = catalogResponse.ok ? await catalogResponse.json() : [];

  // Уже привязанные атрибуты — чтобы не предлагать их повторно.
  const usedAttributeIds = (deviceType.attributes || []).map((attr) =>
    String(attr.attributeId?._id || attr.attributeId),
  );

  return {
    deviceType: { _id: deviceType._id, name: deviceType.name },
    availableAttributes: Array.isArray(catalog) ? catalog : [],
    usedAttributeIds,
  };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();
  const data = await request.formData();

  const body = {
    deviceTypeId: params.id,
    attributeId: data.get("attributeId"),
    required: data.get("required") === "true",
    extendable: data.get("extendable") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-type-attributes/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    },
  );

  // Дубль/битые данные — остаёмся в форме с сообщением (FormWrapper покажет).
  if (response.status === 409 || response.status === 400) {
    const payload = await response.json().catch(() => ({}));
    return {
      error: true,
      message: payload.message || "Не удалось добавить атрибут.",
    };
  }
  if (!response.ok) {
    throw response;
  }
  return { ok: true };
}
