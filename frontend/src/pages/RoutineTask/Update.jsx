import Form from "../../components/RoutineTask/Form";
import { getLocalStorageData } from "../../util/auth";

const UpdateRoutineTaskPage = () => {
  return <Form title="Изменить регламентное задание" />;
};

export default UpdateRoutineTaskPage;

export async function loader({ params }) {
  document.title = "ИЗМЕНИТЬ РЕГЛАМЕНТНОЕ ЗАДАНИЕ";

  const { token } = getLocalStorageData();

  const tasksResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/routine-tasks/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  if (!tasksResponse.ok) {
    throw tasksResponse;
  }

  const companiesResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/companies`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  if (!companiesResponse.ok) {
    throw companiesResponse;
  }

  const serviceAccountsResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/form-data/service-accounts`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  if (!serviceAccountsResponse.ok) {
    throw serviceAccountsResponse;
  }

  const categoriesResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/ticket-categories`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  if (!categoriesResponse.ok) {
    throw categoriesResponse;
  }

  return {
    task: await tasksResponse.json(),
    companiesList: await companiesResponse.json(),
    serviceAccounts: await serviceAccountsResponse.json(),
    categoriesList: await categoriesResponse.json(),
  };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const taskData = {
    title: data.get("title"),
    description: data.get("description"),
    companyId: data.get("company"),
    applicantId: data.get("applicant"),
    categoryId: data.get("category"),
    cronSchedule: data.get("cronSchedule"),
    isActive: data.get("isActive") === "true",
    checklist: data.getAll("checklist"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/routine-tasks/update/${params.id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(taskData),
    }
  );

  if ([400, 409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return await response.json();
}
