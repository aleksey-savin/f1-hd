import { setDocTitle } from "@/hooks/use-doc-title";
import { api } from "@/lib/api";
import { load, invalidate } from "@/store/form-data";

import AssemblyForm from "../../components/DeviceType/AssemblyForm";

// Шторка «Своя сборка» с карточки типа: слоты комплектующих и ключевые
// характеристики (макет «Своя сборка ПК», разд. 2).
const AssemblyPage = () => <AssemblyForm />;

export default AssemblyPage;

export async function loader({ params }) {
  setDocTitle("Своя сборка");

  // Тип — свежий (его состав и правим); список типов — из кэша форм: в слоты
  // идут только типы-комплектующие, сам тип в свой слот не ставится.
  const [deviceType, allDeviceTypes] = await Promise.all([
    api(`/api/inventory/device-types/${params.id}`),
    load("/api/inventory/device-types").catch(() => []),
  ]);

  const componentTypes = (Array.isArray(allDeviceTypes) ? allDeviceTypes : [])
    .filter((type) => type.isComponent && String(type._id) !== params.id)
    .map((type) => ({ _id: String(type._id), name: type.name }));

  return {
    deviceType: {
      _id: deviceType._id,
      name: deviceType.name,
      assembly: deviceType.assembly,
    },
    componentTypes,
  };
}

// Тело — JSON из шторки: { slots: [{ typeId, required, multiple }],
// keySpecs: [{ typeId, source, attributeId, aggregate }] } — состав целиком
export async function action({ request, params }) {
  // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
  invalidate("/api/inventory/");
  const { slots, keySpecs } = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/${params.id}/assembly`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slots, keySpecs }),
    },
  );

  // Битый состав — остаёмся в форме с сообщением сервера (FormWrapper покажет)
  if ([400, 404].includes(response.status)) {
    const payload = await response.json().catch(() => ({}));
    return {
      error: true,
      message: payload.message || "Не удалось сохранить состав сборки.",
    };
  }
  if (!response.ok) {
    throw response;
  }
  return { ok: true };
}
