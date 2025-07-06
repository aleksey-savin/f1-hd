import WorkForm from "../../components/Work/Form";

import { localToUtc } from "../../util/format-date";
import { getLocalStorageData } from "../../util/auth";

const UpdateWorkPage = () => {
  return <WorkForm title="Изменить работы" />;
};

export default UpdateWorkPage;

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
  const workId = data.get("workId");
  const scheduled = data.get("scheduled");

  const linkToTickets = data.getAll("linkToTickets");
  linkToTickets.unshift(ticketId);

  const localStartDateTime = scheduled
    ? localToUtc(data.get("planningToStart"))
    : localToUtc(data.get("startedAt"));
  const localFinishDateTime = scheduled
    ? localToUtc(data.get("planningToFinish"))
    : localToUtc(data.get("finishedAt"));

  let worksData = Object.fromEntries(data);
  if (scheduled) {
    worksData = {
      ...worksData,
      tickets: linkToTickets,
      planningToStart: localStartDateTime,
      planningToFinish: localFinishDateTime,
    };
  } else {
    worksData = {
      ...worksData,
      tickets: linkToTickets,
      startedAt: localStartDateTime,
      finishedAt: localFinishDateTime,
    };
  }

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/works/update/${workId}`,
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
