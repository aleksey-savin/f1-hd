import { useLoaderData } from "react-router";

import Form from "../../components/TicketTemplate/Form";
import { getLocalStorageData } from "../../util/auth";

const UpdateTicketTemplatePage = () => {
  const { template, formData } = useLoaderData();
  return (
    <Form
      title="Изменить шаблон заявки"
      template={template}
      formData={formData}
    />
  );
};

export default UpdateTicketTemplatePage;

export async function loader({ params }) {
  document.title = "ИЗМЕНИТЬ ШАБЛОН ЗАЯВКИ";

  const { token } = getLocalStorageData();

  const templateResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!templateResponse.ok) {
    throw templateResponse;
  }

  const templateData = await templateResponse.json();

  const formDataResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/form-data`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!formDataResponse.ok) {
    throw formDataResponse;
  }

  const formData = await formDataResponse.json();

  return {
    template: templateData,
    formData: formData,
  };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const customFields = JSON.parse(data.get("customFields"));

  const validCustomFields = customFields.filter(
    (field) => field.name.trim() !== "",
  );

  const templateData = {
    title: data.get("title"),
    description: data.get("description"),
    company: data.get("company"),
    category: data.get("category"),
    customFields: validCustomFields,
    sharedUsers: data.getAll("sharedUsers"),
    sharedCompanies: data.getAll("sharedCompanies"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/update/${params.id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(templateData),
    },
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return await response.json();
}
