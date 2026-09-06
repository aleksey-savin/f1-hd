import { api } from "@/lib/api";
import { load } from "@/store/form-data";

import CompanyForm from "../../components/Company/Form";

const UpdateCompanyPage = () => {
  return <CompanyForm />;
};

export default UpdateCompanyPage;

export async function loader({ params }) {
  document.title = "Изменить компанию";

  // Компания — всегда свежая; справочник ответственных — из кэша
  const [companyData, responsibles] = await Promise.all([
    api(`/api/companies/${params.id}`),
    load("/api/users/can-perform-tickets"),
  ]);

  return {
    company: companyData.company,
    responsibles,
  };
}

// Форма шлёт готовый JSON (encType: application/json) — телефоны-массив,
// оба списка ответственных и объект графика уже собраны. Пробрасываем на бэкенд.
export async function action({ request, params }) {
  const body = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/companies/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    let message = "Не удалось сохранить компанию";
    try {
      const data = await response.json();
      message = data.message || message;
    } catch {
      // тело ответа пустое — оставляем дефолтное сообщение
    }
    return { error: true, message };
  }

  return await response.json();
}
