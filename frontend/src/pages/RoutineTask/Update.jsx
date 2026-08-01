import Form from "../../components/RoutineTask/Form";
import { getLocalStorageData } from "../../util/auth";

const UpdateRoutineTaskPage = () => {
  return <Form />;
};

export default UpdateRoutineTaskPage;

const authGet = (path, token) =>
  fetch(`${import.meta.env.VITE_API_ADDRESS}/api/${path}`, {
    headers: { Authorization: "Bearer " + token },
  }).then((response) => {
    if (!response.ok) throw response;
    return response.json();
  });

export async function loader({ params }) {
  document.title = "Изменить регламент";

  const { token } = getLocalStorageData();

  const [
    task,
    companies,
    serviceAccounts,
    categories,
    templates,
    ticketFormData,
  ] = await Promise.all([
    authGet(`routine-tasks/${params.id}`, token),
    authGet("companies", token),
    authGet("form-data/service-accounts", token),
    authGet("ticket-categories", token),
    authGet("ticket-templates", token),
    authGet("tickets/form-data", token),
  ]);

  return {
    task,
    formData: {
      companies,
      serviceAccounts,
      categories,
      templates,
      responsibles: ticketFormData?.responsibles || [],
    },
  };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const payload = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks/update/${params.id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    },
  );

  if (response.status === 400) {
    const body = await response.json().catch(() => ({}));
    return { error: true, message: body.message || "Проверьте расписание" };
  }
  if (response.status === 409) {
    return { error: true, message: "Конфликт версий — обновите страницу" };
  }
  if (!response.ok) {
    throw response;
  }

  return await response.json();
}
