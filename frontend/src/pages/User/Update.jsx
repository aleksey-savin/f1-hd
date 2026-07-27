import { redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import UserForm from "../../components/User/UserForm";

const UpdateUserPage = () => {
  return <UserForm />;
};

export default UpdateUserPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();
  if (!token) {
    return redirect("/auth");
  }

  const userResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/${params.id}`,
    { headers: { Authorization: "Bearer " + token } },
  );

  const user = await userResponse.json();

  // includeInactive: у пользователя отключённой компании селект «Компания»
  // обязан находить её опцию — иначе сохранение молча затрёт связь
  const companiesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/companies?includeInactive=true`,
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

  return { user, companiesList: companies, categoriesList: categories };
}

// Форма присылает готовый payload (JSON) — пересылаем как есть. `role` не
// отправляем вовсе: поля в форме нет, а прежний `role: null` затирал сохранённое
// значение при каждом сохранении (бэкенд теперь оставляет прежнее).
export async function action({ request, params }) {
  const { token } = getLocalStorageData();
  const userData = await request.json();

  // Форма, открытая только на секции графика (право на графики без права на
  // пользователей), шлёт один блок: общий endpoint закрыт canManageUsers,
  // поэтому такой payload уходит на endpoint графика.
  const keys = Object.keys(userData);
  const scheduleOnly = keys.length === 1 && keys[0] === "workSchedule";

  const response = await fetch(
    scheduleOnly
      ? `${import.meta.env.VITE_API_ADDRESS}/api/users/${params.id}/work-schedule`
      : `${import.meta.env.VITE_API_ADDRESS}/api/users/update/${params.id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(scheduleOnly ? userData.workSchedule : userData),
    },
  );

  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    return {
      error: true,
      message: body.message || "Пользователь с такой почтой уже есть",
    };
  }

  if (!response.ok) {
    throw Response.json(
      { message: "Не удалось изменить пользователя" },
      { status: 500 },
    );
  }

  return await response.json();
}
