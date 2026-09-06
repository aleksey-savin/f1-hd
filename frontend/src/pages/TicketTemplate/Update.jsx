import { api } from "@/lib/api";
import { load } from "@/store/form-data";
import Form from "../../components/TicketTemplate/Form";

const UpdateTicketTemplatePage = () => <Form />;

export default UpdateTicketTemplatePage;

export async function loader({ params }) {
  document.title = "Изменить шаблон";

  // Шаблон — всегда свежий; справочники формы заявки — из кэша
  const [template, formData] = await Promise.all([
    api(`/api/ticket-templates/${params.id}`),
    load("/api/tickets/form-data"),
  ]);

  return { template, formData };
}

export async function action({ request, params }) {
  const payload = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/update/${params.id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    return { error: true, message: "Не удалось сохранить шаблон" };
  }

  return await response.json();
}
