import { useLoaderData } from "react-router";

import { setDocTitle } from "@/hooks/use-doc-title";
import { api, ApiError } from "@/lib/api";
import { invalidate } from "@/store/form-data";
import GroupsSheet from "../../components/DeviceAttribute/GroupsSheet";

// Справочник групп атрибутов — шторка над списком «Атрибуты» (кнопка «Группы»).
// Все правки идут через action этого маршрута: create/rename — диалог имени,
// reorder — перетаскивание, delete — DeleteDialog.
const AttributeGroupsPage = () => {
  const groups = useLoaderData();

  return <GroupsSheet groups={groups || []} />;
};

export default AttributeGroupsPage;

export async function loader() {
  setDocTitle("Группы атрибутов");

  return api("/api/inventory/attribute-groups");
}

const BASE = "/api/inventory/attribute-groups";

// Текст ошибки для тоста: 400/409 бэкенд пишет по-русски («Группа «…» уже
// есть», «Группа используется»), прочее (404, 5xx) — служебное, его заменяем.
const FALLBACK = {
  create: "Не удалось создать группу.",
  rename: "Не удалось переименовать группу.",
  reorder: "Не удалось изменить порядок групп.",
  delete: "Не удалось удалить группу.",
};
const errorMessage = (error, intent) => {
  if (error.status === 404) {
    return "Группа не найдена — возможно, её уже удалили.";
  }
  if (error.status === 400 || error.status === 409) return error.message;
  return FALLBACK[intent] || "Не удалось сохранить изменения.";
};

export async function action({ request }) {
  // Группы — справочник каталога: формы атрибутов и типов возьмут свежие
  invalidate("/api/inventory/");
  const data = await request.formData();
  const intent = data.get("intent");
  const id = data.get("id");

  try {
    if (intent === "create") {
      const body = await api(`${BASE}/add`, {
        method: "POST",
        body: { name: data.get("name") },
      });
      return { ok: true, intent, attributeGroup: body?.attributeGroup };
    }

    if (intent === "rename") {
      const body = await api(`${BASE}/update/${id}`, {
        method: "PUT",
        body: { name: data.get("name") },
      });
      return { ok: true, intent, attributeGroup: body?.attributeGroup };
    }

    if (intent === "reorder") {
      await api(`${BASE}/reorder`, {
        method: "PUT",
        body: { orderedIds: JSON.parse(data.get("orderedIds") || "[]") },
      });
      return { ok: true, intent };
    }

    if (intent === "delete") {
      await api(`${BASE}/delete/${id}`, { method: "POST" });
      return { ok: true, intent };
    }
  } catch (error) {
    // 401 api() уже обработал (выход) — пусть его ловит экран ошибки
    if (error instanceof ApiError && error.status !== 401) {
      return { error: true, intent, message: errorMessage(error, intent) };
    }
    throw error;
  }

  return { ok: true };
}
