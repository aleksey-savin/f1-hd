import { api } from "@/lib/api";
import { load } from "@/store/form-data";
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

  // Пользователь — всегда свежий; справочники — из кэша (store/form-data),
  // 401 обрабатывает lib/api. includeInactive: у пользователя отключённой
  // компании селект «Компания» обязан находить её опцию — иначе сохранение
  // молча затрёт связь
  const [user, companies, categories] = await Promise.all([
    api(`/api/users/${params.id}`),
    load("/api/companies?includeInactive=true"),
    load("/api/ticket-categories"),
  ]);

  return { user, companiesList: companies, categoriesList: categories };
}

// Форма присылает готовый payload (JSON) — пересылаем как есть. `role` не
// отправляем вовсе: поля в форме нет, а прежний `role: null` затирал сохранённое
// значение при каждом сохранении (бэкенд теперь оставляет прежнее).
export async function action({ request, params }) {
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
      },
      body: JSON.stringify(scheduleOnly ? userData.workSchedule : userData),
    },
  );

  // 409 — почта занята, 400 — отказ проверки (например, пустой набор ролей).
  // Оба — ошибки формы: показываем сообщение в ней, а не страницу ошибки.
  if (response.status === 409 || response.status === 400) {
    const body = await response.json().catch(() => ({}));
    return {
      error: true,
      message:
        body.message ||
        (response.status === 409
          ? "Пользователь с такой почтой уже есть"
          : "Не удалось изменить пользователя"),
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
