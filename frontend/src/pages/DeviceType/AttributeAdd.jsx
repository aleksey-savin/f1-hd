import { setDocTitle } from "@/hooks/use-doc-title";
import { api } from "@/lib/api";
import { load, invalidate } from "@/store/form-data";

import AttributesAddForm from "../../components/DeviceType/AttributesAddForm";
import { ATTRIBUTE_GROUPS_PATH } from "../../components/DeviceType/attribute-groups";

const AttributeAddPage = () => <AttributesAddForm />;

export default AttributeAddPage;

export async function loader({ params }) {
  setDocTitle("Добавить атрибуты типа");

  // Тип — свежий (по нему считаем занятые атрибуты); каталог — из кэша.
  // Группы только прогреваем: поле «Группа» берёт их из того же кэша.
  const [deviceType, catalog] = await Promise.all([
    api(`/api/inventory/device-types/${params.id}`),
    load("/api/inventory/device-attributes").catch(() => []),
    load(ATTRIBUTE_GROUPS_PATH).catch(() => []),
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

// Пачка из шторки (JSON): { items: [{ attributeId } | { attribute }], groupId }
// — новые атрибуты бэкенд создаёт в каталоге и добавляет к типу одним
// запросом; группа (или null) ложится на все созданные связки
export async function action({ request, params }) {
  // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
  invalidate("/api/inventory/");
  const { items, groupId } = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-type-attributes/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceTypeId: params.id,
        items,
        groupId: groupId || null,
      }),
    },
  );

  // Дубль/битые данные — остаёмся в форме с сообщением (FormWrapper покажет).
  if ([400, 404, 409].includes(response.status)) {
    const payload = await response.json().catch(() => ({}));
    return {
      error: true,
      message: payload.message || "Не удалось добавить атрибуты.",
    };
  }
  if (!response.ok) {
    throw response;
  }
  return { ok: true };
}
