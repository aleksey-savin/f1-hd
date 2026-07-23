import { getLocalStorageData } from "../../util/auth";

import UpdateTicket from "../../components/Ticket/Update";

const UpdateTicketPage = () => {
  return <UpdateTicket />;
};

export default UpdateTicketPage;

export async function loader({ params }) {
  document.title = `Изменить заявку ${params.ticketNum}`;

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
