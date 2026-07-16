import ServicePlanForm from "../../components/ServicePlan/Form";
import { getLocalStorageData } from "../../util/auth";

const AddServicePlanPage = () => {
  return <ServicePlanForm title="Новая услуга" />;
};

export default AddServicePlanPage;

export async function loader() {
  document.title = "НОВАЯ УСЛУГА";

  const { token } = getLocalStorageData();

  const ticketCategoriesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!ticketCategoriesResponse.ok) {
    throw ticketCategoriesResponse;
  }

  return {
    ticketCategories: await ticketCategoriesResponse.json(),
  };
}

// Мастер услуги шлёт готовый JSON (encType: application/json) — форма уже
// собрала типы (числа/булевы), график-объект и пакеты. Пробрасываем на бэкенд.
export async function action({ request }) {
  const { token } = getLocalStorageData();

  const body = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/finances/service-plans/add`,
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
    let message = "Не удалось сохранить услугу";
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
