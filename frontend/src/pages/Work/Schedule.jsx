import FormScheduled from "../../components/Work/FormScheduled";
import { getLocalStorageData } from "../../util/auth";

const AddScheduledWorkPage = () => {
  return <FormScheduled title="Запланировать работы" />;
};

export default AddScheduledWorkPage;

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

  const localPlanningToStartDateTime = new Date(data.get("planningToStart"));
  const localPlanningToFinishDateTime = new Date(data.get("planningToFinish"));

  let worksData = Object.fromEntries(data);
  worksData = {
    ...worksData,
    tickets: linkToTickets,
    planningToStart: localPlanningToStartDateTime.toISOString(),
    planningToFinish: localPlanningToFinishDateTime.toISOString(),
  };

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/works/schedule`,
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
