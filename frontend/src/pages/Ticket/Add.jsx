import { redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import AddTicket from "../../components/Ticket/Add";

const AddTicketPage = () => {
  return <AddTicket />;
};

export default AddTicketPage;

export async function loader() {
  document.title = "НОВАЯ ЗАЯВКА";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/tickets/form-data`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}

export async function action() {
  return redirect("/tickets");
}
