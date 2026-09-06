import { load } from "@/store/form-data";
import Form from "../../components/RoutineTask/Form";

const AddRoutineTaskPage = () => {
  return <Form />;
};

export default AddRoutineTaskPage;

export async function loader({ request }) {
  document.title = "Новый регламент";

  const fromTemplate = new URL(request.url).searchParams.get("fromTemplate");

  // Справочники — из кэша (store/form-data): их пять, и без кэша форма ждала
  // бы все пять на каждом открытии
  const [
    companies,
    serviceAccounts,
    categories,
    templates,
    ticketFormData,
    prefillTemplate,
  ] = await Promise.all([
    load("/api/companies"),
    load("/api/form-data/service-accounts"),
    load("/api/ticket-categories"),
    load("/api/ticket-templates"),
    load("/api/tickets/form-data"),
    fromTemplate ? load(`/api/ticket-templates/${fromTemplate}`) : null,
  ]);

  return {
    task: {},
    formData: {
      companies,
      serviceAccounts,
      categories,
      templates,
      responsibles: ticketFormData?.responsibles || [],
    },
    prefillTemplate,
  };
}

export async function action({ request }) {

  const payload = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
