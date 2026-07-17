import { useContext } from "react";

import AttributeForm from "../../components/DeviceType/AttributeForm";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const AttributeUpdatePage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageClientDevices } = permissions;

  if (!canUseInventoryModule || !canManageClientDevices) {
    return <Forbidden />;
  }
  return <AttributeForm title="Изменить атрибут" />;
};

export default AttributeUpdatePage;

export async function loader({ params }) {
  document.title = "Изменить атрибут типа";

  const { token } = getLocalStorageData();
  const headers = { Authorization: "Bearer " + token };
  const base = `${import.meta.env.VITE_API_ADDRESS}/api/inventory`;

  const [linkResponse, typeResponse, catalogResponse] = await Promise.all([
    fetch(`${base}/device-type-attributes/${params.attrId}`, { headers }),
    fetch(`${base}/device-types/${params.id}`, { headers }),
    fetch(`${base}/device-attributes`, { headers }),
  ]);
  if (!linkResponse.ok) {
    throw linkResponse;
  }
  const link = await linkResponse.json();
  const deviceType = typeResponse.ok ? await typeResponse.json() : {};
  const catalog = catalogResponse.ok ? await catalogResponse.json() : [];

  const usedAttributeIds = (deviceType.attributes || []).map((attr) =>
    String(attr.attributeId?._id || attr.attributeId),
  );

  return {
    link,
    deviceType: {
      _id: deviceType._id || params.id,
      name: deviceType.name,
    },
    availableAttributes: Array.isArray(catalog) ? catalog : [],
    usedAttributeIds,
  };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();
  const data = await request.formData();

  const body = {
    attributeId: data.get("attributeId"),
    required: data.get("required") === "true",
    extendable: data.get("extendable") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-type-attributes/update/${params.attrId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    },
  );

  if (response.status === 409 || response.status === 400) {
    const payload = await response.json().catch(() => ({}));
    return {
      error: true,
      message: payload.message || "Не удалось сохранить атрибут.",
    };
  }
  if (!response.ok) {
    throw response;
  }
  return { ok: true };
}
