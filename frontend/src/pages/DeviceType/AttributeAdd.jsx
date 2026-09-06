import { api } from "@/lib/api";
import { load } from "@/store/form-data";

import AttributeForm from "../../components/DeviceType/AttributeForm";

const AttributeAddPage = () => {

  return <AttributeForm title="Добавить атрибут" />;
};

export default AttributeAddPage;

export async function loader({ params }) {
  document.title = "Добавить атрибут типа";

  // Тип — свежий (по нему считаем занятые атрибуты); каталог — из кэша
  const [deviceType, catalog] = await Promise.all([
    api(`/api/inventory/device-types/${params.id}`),
    load("/api/inventory/device-attributes").catch(() => []),
  ]);

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
