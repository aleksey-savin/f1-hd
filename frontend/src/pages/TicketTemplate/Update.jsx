import Form from "../../components/TicketTemplate/Form";

const UpdateTicketTemplatePage = () => <Form />;

export default UpdateTicketTemplatePage;

export async function loader({ params }) {
  document.title = "Изменить шаблон";

  const templateResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/${params.id}`,
  );

  if (!templateResponse.ok) {
    throw templateResponse;
  }

  const template = await templateResponse.json();

  const formDataResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/form-data`,
  );

  if (!formDataResponse.ok) {
    throw formDataResponse;
  }

  const formData = await formDataResponse.json();

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
