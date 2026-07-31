import { getLocalStorageData } from "../../util/auth";

// Loader и action всех форм работ. Пять маршрутов отличались только адресом
// запроса, а копий кода было пять — время в UTC каждая переводила сама, и одна
// из них делала это браузерным форматтером.
//
// Тело формы уже собрано и переведено в UTC (`useWorkForm.buildPayload`),
// поэтому action только пересылает JSON.

const api = (path) => `${import.meta.env.VITE_API_ADDRESS}/api${path}`;

/** Что форме нужно сразу при открытии: с какой даты можно указывать работы. */
export async function workFormLoader({ params }) {
  const { token } = getLocalStorageData();

  const response = await fetch(
    api(`/works/additional-data/${params.ticketNum}`),
    { headers: { Authorization: "Bearer " + token } },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}

const post = async (url, payload) => {
  const { token } = getLocalStorageData();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(payload),
  });

  // 409 — оптимистическая блокировка: сервер называет причину словами, форма
  // показывает её алертом, а не страницей ошибки
  if (response.status === 409) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return await response.json();
};

export async function addWorkAction({ request }) {
  return post(api("/works/add"), await request.json());
}

export async function scheduleWorkAction({ request }) {
  return post(api("/works/schedule"), await request.json());
}

export async function updateWorkAction({ request, params }) {
  return post(api(`/works/update/${params.workId}`), await request.json());
}
