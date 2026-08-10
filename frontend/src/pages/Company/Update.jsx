
import CompanyForm from "../../components/Company/Form";

const UpdateCompanyPage = () => {
  return <CompanyForm />;
};

export default UpdateCompanyPage;

export async function loader({ params }) {
  document.title = "Изменить компанию";

  const companyResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/companies/${params.id}`,
      );

  if (!companyResponse.ok) {
    throw companyResponse;
  }

  const respResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/can-perform-tickets`,
      );

  if (!respResponse.ok) {
    throw respResponse;
  }

  const companyData = await companyResponse.json();

  return {
    company: companyData.company,
    responsibles: await respResponse.json(),
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
