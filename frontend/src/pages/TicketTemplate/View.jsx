import { useLoaderData, redirect } from "react-router";


import ViewTicketTemplate from "../../components/TicketTemplate/View";

const ViewTicketTemplatePage = () => {
  const { template } = useLoaderData();
  return <ViewTicketTemplate template={template} />;
};

export default ViewTicketTemplatePage;

export async function loader({ params }) {
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/${params.id}`,
      );

  if (!response.ok) {
    throw response;
  }

  const template = await response.json();

  document.title = "Просмотр шаблона";

  return { template };
}

export async function action({ request, params }) {
  const data = await request.formData();
  const intent = data.get("intent");
  const id = data.get("id");

  // Правка чек-листа с карточки — отдельным запросом, не трогая остальной шаблон.
  if (intent === "updateChecklist") {
    const checklist = JSON.parse(data.get("checklist") || "[]");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/${params.id}/checklist`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ checklist }),
      },
    );

    if (!response.ok) {
      return { error: true };
    }

    return await response.json();
  }

  if (intent === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/delete/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return redirect("/ticket-templates");
  }
}
