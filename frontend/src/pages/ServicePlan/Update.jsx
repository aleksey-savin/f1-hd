import ServicePlanForm from "../../components/ServicePlan/Form";
import { getLocalStorageData } from "../../util/auth";

const UpdateServicePlanPage = () => {
  return <ServicePlanForm title="Изменить услугу" />;
};

export default UpdateServicePlanPage;

export async function loader({ params }) {
  document.title = "ИЗМЕНЕНИЕ УСЛУГИ";

  const { token } = getLocalStorageData();

  const servicePlanResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/finances/service-plans/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!servicePlanResponse.ok) {
    throw servicePlanResponse;
  }

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
    servicePlan: await servicePlanResponse.json(),
    ticketCategories: await ticketCategoriesResponse.json(),
  };
}

// Мастер услуги шлёт готовый JSON (encType: application/json) — форма уже
// собрала типы (числа/булевы), график-объект и пакеты. Пробрасываем на бэкенд.
export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const body = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/finances/service-plans/update/${params.id}`,
    {
      method: "PUT",
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
