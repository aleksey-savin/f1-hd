import { useLoaderData } from "react-router";

import RoleForm from "../../components/Role/Form";
import { api } from "@/lib/api";

const UpdateRolePage = () => {
  const { role } = useLoaderData();
  return <RoleForm role={role} />;
};

export default UpdateRolePage;

export async function loader({ params }) {
  document.title = "Изменить роль";

  // Отдельной ручки «одна роль» нет намеренно: каталог — девять строк, и
  // второй эндпоинт ради выборки одной из них был бы работой ради работы.
  const data = await api("/api/roles");
  const role = (data.roles || []).find((item) => item.key === params.key);

  if (!role) {
    throw new Response("Роль не найдена", { status: 404 });
  }

  return { role };
}
