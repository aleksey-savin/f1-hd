import { useLoaderData, redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import ViewRoutineTask from "../../components/RoutineTask/View";

const ViewRoutineTaskPage = () => {
  const { task } = useLoaderData();
  return <ViewRoutineTask task={task} />;
};

export default ViewRoutineTaskPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  const task = await response.json();

  document.title = "Просмотр регламента";

  return { task };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const intent = data.get("intent");

  if (intent === "updateChecklist") {
    const checklist = JSON.parse(data.get("checklist") || "[]");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks/${params.id}/checklist`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ checklist }),
      },
    );

    if (!response.ok) {
      return { error: true };
    }

    return await response.json();
  }

  if (intent === "run") {
    const skipNext = data.get("skipNext") === "true";

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks/${params.id}/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ skipNext }),
      },
    );

    if (!response.ok) {
      return { error: true };
    }

    return await response.json();
  }

  if (intent === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks/delete/${params.id}`,
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

    return redirect("/routine-tasks");
  }

  return null;
}
