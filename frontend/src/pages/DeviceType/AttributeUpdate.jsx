import { api } from "@/lib/api";
import { load } from "@/store/form-data";

import AttributeForm from "../../components/DeviceType/AttributeForm";

const AttributeUpdatePage = () => {

  return <AttributeForm title="Изменить атрибут" />;
};

export default AttributeUpdatePage;

export async function loader({ params }) {
  document.title = "Изменить атрибут типа";

  // Привязка и тип — свежие; каталог атрибутов — из кэша (store/form-data)
  const [link, deviceType, catalog] = await Promise.all([
    api(`/api/inventory/device-type-attributes/${params.attrId}`),
    api(`/api/inventory/device-types/${params.id}`).catch(() => ({})),
    load("/api/inventory/device-attributes").catch(() => []),
  ]);

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
