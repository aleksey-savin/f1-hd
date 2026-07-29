import WorkForm from "../../components/Work/Form";

import { localToUtc } from "../../util/format-date";
import { getLocalStorageData } from "../../util/auth";

const AddWorkPage = () => {
  return <WorkForm title="Новые работы" />;
};

export default AddWorkPage;

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

  // Форма отдаёт настенное время в бизнес-таймзоне (utcToLocalForm /
  // toDateTimeLocal при загрузке) — обратно в UTC его переводит только
  // localToUtc. new Date(value) взял бы зону браузера, и работа, созданная из
  // другого пояса, легла бы в базу со сдвигом.
  const startedAt = localToUtc(data.get("startedAt"));
  const finishedAt = localToUtc(data.get("finishedAt"));

  let worksData = Object.fromEntries(data);
  worksData = {
    ...worksData,
    tickets: linkToTickets,
    startedAt,
    finishedAt,
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/works/add`,
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
