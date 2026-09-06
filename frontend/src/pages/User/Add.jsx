import { load } from "@/store/form-data";
import { redirect } from "react-router";

import UserForm from "../../components/User/UserForm";
import { getLocalStorageData } from "../../util/auth";

const AddUserPage = () => {
  return <UserForm />;
};

export default AddUserPage;

export async function loader() {
  const { token } = getLocalStorageData();

  if (!token) {
    return redirect("/auth");
  }

  // Справочники — из кэша (store/form-data); 401 обрабатывает lib/api
  const [companies, categories] = await Promise.all([
    load("/api/companies"),
    load("/api/ticket-categories"),
  ]);

  return { companiesList: companies, categoriesList: categories };
}

// Форма присылает готовый payload (JSON) — здесь только пересылаем его на API.
// Раньше тело собиралось из FormData вручную и теряло данные: подразделение не
// уходило вовсе, `canManageServicPlans` был опечаткой, часть прав отправлялась
// строкой вместо boolean, а `role: null` затирал сохранённую роль.
export async function action({ request }) {
  const userData = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userData),
    },
  );

  // 409 — почта занята. Нормализуем в { error }, иначе форма посчитает ответ
  // успехом и закроется.
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    return {
      error: true,
      message: body.message || "Пользователь с такой почтой уже есть",
    };
  }

  if (!response.ok) {
    throw Response.json(
      { message: "Не удалось создать пользователя" },
      { status: 500 },
    );
  }

  return await response.json();
}
