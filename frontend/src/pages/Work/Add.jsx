import WorkForm from "../../components/Work/Form";
import { getLocalStorageData } from "../../util/auth";

const AddWorkPage = () => {
  return <WorkForm title="Новые работы" />;
};

export default AddWorkPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/works/additional-data/${params.ticketNum}`,
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

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const ticketId = data.get("ticketId");
  const linkToTickets = data.getAll("linkToTickets");
  linkToTickets.unshift(ticketId);

  const localStartedAtDateTime = new Date(data.get("startedAt"));
  const localFinishedAtDateTime = new Date(data.get("finishedAt"));

  let worksData = Object.fromEntries(data);
  worksData = {
    ...worksData,
    tickets: linkToTickets,
    startedAt: localStartedAtDateTime.toISOString(),
    finishedAt: localFinishedAtDateTime.toISOString(),
  };

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/works/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(worksData),
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
