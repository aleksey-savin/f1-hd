import { setDocTitle } from "@/hooks/use-doc-title";
import { api } from "@/lib/api";
import { load, invalidate } from "@/store/form-data";

import AttributeForm from "../../components/DeviceType/AttributeForm";
import { ATTRIBUTE_GROUPS_PATH } from "../../components/DeviceType/attribute-groups";

const AttributeUpdatePage = () => {

  return <AttributeForm title="Изменить атрибут" />;
};

export default AttributeUpdatePage;

export async function loader({ params }) {
  setDocTitle("Изменить атрибут типа");

  // Привязка и тип — свежие; каталог атрибутов — из кэша (store/form-data).
  // Группы только прогреваем: поле «Группа» берёт их из того же кэша.
  const [link, deviceType, catalog] = await Promise.all([
    api(`/api/inventory/device-type-attributes/${params.attrId}`),
    api(`/api/inventory/device-types/${params.id}`).catch(() => ({})),
    load("/api/inventory/device-attributes").catch(() => []),
    load(ATTRIBUTE_GROUPS_PATH).catch(() => []),
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
  // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
  invalidate("/api/inventory/");
  const data = await request.formData();

  const body = {
    attributeId: data.get("attributeId"),
    required: data.get("required") === "true",
    extendable: data.get("extendable") === "true",
    // Пусто — «Без группы»: null снимает группу
    groupId: data.get("groupId") || null,
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

  // 404 — группу успели удалить, пока форма была открыта
  if ([400, 404, 409].includes(response.status)) {
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
