import RoleForm from "../../components/Role/Form";
import { api, ApiError } from "@/lib/api";

const AddRolePage = () => <RoleForm />;

export default AddRolePage;

// Каталог для старта «Из роли». Ручки «одна роль» нет намеренно (см. лоадер
// правки) — каталог маленький и приезжает целиком одним запросом.
export async function loader() {
  document.title = "Новая роль";
  const data = await api("/api/roles");
  return { roles: data?.roles || [] };
}

// Сабмит — router-action (`app/FormWrapper`), как у остальных справочников.
// Список ролей отсюда не перезапрашиваем: он делает это сам при возврате на
// /roles (эффект по `location.key` в pages/Role/List.jsx).
export async function action({ request }) {
  const body = await request.json();
  try {
    const data = await api("/api/roles", { method: "POST", body });
    return { role: data?.role };
  } catch (failure) {
    return {
      error: true,
      message:
        failure instanceof ApiError
          ? failure.message
          : "Не удалось сохранить роль",
    };
  }
}
