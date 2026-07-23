import CompanyForm from "../../components/Company/Form";
import { getLocalStorageData } from "../../util/auth";

const AddCompanyPage = () => {
  return <CompanyForm />;
};

export default AddCompanyPage;

export async function loader() {
  document.title = "Новая компания";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/can-perform-tickets`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return {
    responsibles: await response.json(),
  };
}

// Мастер шлёт готовый JSON (encType: application/json) — телефоны-массив,
// ответственные и объект графика уже собраны формой. Пробрасываем на бэкенд;
// ответ содержит созданную компанию — форма уводит на её карточку.
export async function action({ request }) {
  const { token } = getLocalStorageData();

  const body = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/companies/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
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
