import FormScheduled from "../../components/Work/FormScheduled";

import { localToUtc } from "../../util/format-date";
import { getLocalStorageData } from "../../util/auth";

const AddScheduledWorkPage = () => {
  return <FormScheduled title="Запланировать работы" />;
};

export default AddScheduledWorkPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/works/additional-data/${params.ticketNum}`,
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

  // Симметрично загрузке формы: FormScheduled показывает настенное время в
  // бизнес-таймзоне, обратно переводит localToUtc. new Date(value) прочитал бы
  // его в зоне браузера и сдвинул план на разницу поясов.
  const planningToStart = localToUtc(data.get("planningToStart"));
  const planningToFinish = localToUtc(data.get("planningToFinish"));

  let worksData = Object.fromEntries(data);
  worksData = {
    ...worksData,
    tickets: linkToTickets,
    planningToStart,
    planningToFinish,
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/works/schedule`,
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
