import { redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

// Router-action карточки заявки: все мутации над заявкой идут одним intent'ом.
// Вынесено из View.jsx — там это было больше трети файла и мешало читать
// разметку. Контракт не менялся: каждое действие шлёт expectedVersion, а 409
// возвращается наверх, чтобы экран показал человеческую причину.

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const intent = data.get("intent");

  if (intent === "process") {
    const ticketData = {
      _id: data.get("_id"),
      title: data.get("title"),
      description: data.get("description"),
      company: JSON.parse(data.get("company")),
      categoryId: data.get("categoryId"),
      applicantId: data.get("applicantId"),
      responsibles: JSON.parse(data.get("responsibles")),
      deadline: new Date(data.get("deadline")),
      expectedVersion: data.get("expectedVersion"),
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/process`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(ticketData),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "takeToWork") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/take-to-work`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          takeOver: data.get("takeOver") === "true",
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "reject") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/reject`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          rejectDesc: data.get("rejectDesc"),
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

    if (!response.ok) {
      throw response;
    }

    return redirect("/tickets");
  }

  if (intent === "join") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/join-responsibles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "requestHelp") {
    const ticketData = {
      _id: data.get("_id"),
      responsibles: JSON.parse(data.get("responsibles")),
      expectedVersion: data.get("expectedVersion"),
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/request-help`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(ticketData),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

    if (!response.ok) {
      throw response;
    }
    return response;
  }

  if (intent === "updateDeadline") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/update-deadline`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          deadline: data.get("deadline"),
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "close") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/close`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          closingComment: data.get("closingComment"),
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

    // 422 — правило процесса (нет работ, невыполненный обязательный пункт).
    // Интерфейс их и так не пускает, но между открытием диалога и сабмитом
    // состояние могло измениться: показываем причину тостом, а не страницей
    // ошибки (useTicketAction)
    if ([403, 422].includes(response.status)) {
      return await response.json();
    }

    if (!response.ok) {
      throw response;
    }

    return redirect("/tickets");
  }

  if (intent === "backToWork") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/back-to-work`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          returningComment: data.get("returningComment"),
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось вернуть заявку в работу" },
        { status: 500 },
      );
    }

    return response;
  }

  if (intent === "addComment") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/comments/add`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
        },
        body: data,
      },
    );

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "updateChecklistItem") {
    const ticketNum = data.get("ticketNum");

    const checklistItem = {
      _id: data.get("itemId"),
      description: data.get("itemDescription"),
      checked: data.get("itemChecked"),
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticketNum}/update-checklist-item`,
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

  // Удаление работы с карточки: бэкенд сам проверит, что удаляет автор работы
  // или администратор. Через action, а не своим fetch — иначе список работ
  // останется прежним до следующей ревалидации.
  if (intent === "deleteWork") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/works/delete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ _id: data.get("workId") }),
      },
    );

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  // Состав чек-листа целиком — секция карточки шлёт его после каждого
  // изменения. Отметки сервер поднимает из сохранённых пунктов, поэтому
  // здесь достаточно текста, обязательности и порядка.
  if (intent === "updateChecklist") {
    const ticketNum = data.get("ticketNum");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticketNum}/update-checklist`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          checklist: JSON.parse(data.get("checklist")),
          // Источник нужен хронике: «составлен ИИ» и правка руками — разные
          // события, и в истории они должны различаться
          ...(data.get("source") ? { source: data.get("source") } : {}),
        }),
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

  if (intent === "delete") {
    const ticketId = data.get("id");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/delete/${ticketId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
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

  return null;
}
