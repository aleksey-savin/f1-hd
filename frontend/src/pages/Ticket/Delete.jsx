
import { redirect } from "react-router";

export async function action({ request }) {
  const data = await request.formData();

  const ticketId = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/delete/${ticketId}`,
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

  return redirect("/tickets");
}
