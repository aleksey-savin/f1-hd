import { getLocalStorageData } from "../../util/auth";

import UpdateTicket from "../../components/Ticket/Update";
import { redirect } from "react-router";

const UpdateTicketPage = () => {
  return <UpdateTicket />;
};

export default UpdateTicketPage;

export async function loader({ params }) {
  document.title = `ИЗМЕНЕНИЕ ЗАЯВКИ ${params.ticketNum}`;

  const { token } = getLocalStorageData();

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

  const ticketResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${params.ticketNum}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!ticketResponse.ok) {
    throw ticketResponse;
  }

  return {
    formData: await formDataResponse.json(),
    ticketData: await ticketResponse.json(),
  };
}

export async function action(request, params) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const intent = data.get("intent");

  if (intent === "update-сheck-list") {
    const ticketId = params.ticketId;

    const checklistItem = data.get("checklistItem");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticketId}/update-checklist`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(checklistItem),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  return redirect("/tickets");
}
