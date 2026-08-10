import Form from "../../components/TicketTemplate/Form";

const AddTicketTemplatePage = () => <Form />;

export default AddTicketTemplatePage;

export async function loader() {
  document.title = "Новый шаблон";

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/form-data`,
  );

  if (!response.ok) {
    throw response;
  }

  const formData = await response.json();

  return { formData };
}

export async function action({ request }) {
  const payload = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    return { error: true, message: "Не удалось создать шаблон" };
  }

  return await response.json();
}
