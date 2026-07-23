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

  const companiesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/companies`,
    { headers: { Authorization: "Bearer " + token } },
  );

  const companies = await companiesResponse.json();

  const categoriesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories`,
    { headers: { Authorization: "Bearer " + token } },
  );

  const categories = await categoriesResponse.json();

  if (!companiesResponse.ok) {
    if (companiesResponse.status === 401 || companiesResponse.status === 402) {
      return redirect("/auth");
    }
    throw Response.json(
      { message: companiesResponse.message },
      { status: companiesResponse.status },
    );
  }
  if (!categoriesResponse.ok) {
    if (categoriesResponse.status === 401 || categoriesResponse.status === 402) {
      return redirect("/auth");
    }
    throw Response.json(
      { message: categoriesResponse.message },
      { status: categoriesResponse.status },
    );
  }

  return { companiesList: companies, categoriesList: categories };
}

// Форма присылает готовый payload (JSON) — здесь только пересылаем его на API.
// Раньше тело собиралось из FormData вручную и теряло данные: подразделение не
// уходило вовсе, `canManageServicPlans` был опечаткой, часть прав отправлялась
// строкой вместо boolean, а `role: null` затирал сохранённую роль.
export async function action({ request }) {
  const { token } = getLocalStorageData();
  const userData = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
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
