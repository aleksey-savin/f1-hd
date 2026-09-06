import { api } from "@/lib/api";
import { load } from "@/store/form-data";
import Form from "../../components/RoutineTask/Form";

const UpdateRoutineTaskPage = () => {
  return <Form />;
};

export default UpdateRoutineTaskPage;

export async function loader({ params }) {
  document.title = "Изменить регламент";

  // Регламент — всегда свежий; справочники — из кэша (store/form-data)
  const [
    task,
    companies,
    serviceAccounts,
    categories,
    templates,
    ticketFormData,
  ] = await Promise.all([
    api(`/api/routine-tasks/${params.id}`),
    load("/api/companies"),
    load("/api/form-data/service-accounts"),
    load("/api/ticket-categories"),
    load("/api/ticket-templates"),
    load("/api/tickets/form-data"),
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

  const payload = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks/update/${params.id}`,
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
