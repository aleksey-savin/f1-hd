import Form from "../../components/RoutineTask/Form";
import { getLocalStorageData } from "../../util/auth";

const AddRoutineTaskPage = () => {
  return <Form title="Новое регламентное задание" />;
};

export default AddRoutineTaskPage;

export async function loader() {
  document.title = "ДОБАВИТЬ РЕГЛАМЕНТНОЕ ЗАДАНИЕ";

  const { token } = getLocalStorageData();

  const companiesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/companies`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!companiesResponse.ok) {
    throw companiesResponse;
  }

  const serviceAccountsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/form-data/service-accounts`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!serviceAccountsResponse.ok) {
    throw serviceAccountsResponse;
  }

  const categoriesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!categoriesResponse.ok) {
    throw categoriesResponse;
  }

  return {
    task: {},
    companiesList: await companiesResponse.json(),
    serviceAccounts: await serviceAccountsResponse.json(),
    categoriesList: await categoriesResponse.json(),
  };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const routineData = {
    title: data.get("title"),
    description: data.get("description"),
    cronSchedule: data.get("cronSchedule"),
    applicantId: data.get("applicant"),
    companyId: data.get("company"),
    categoryId: data.get("category"),
    isActive: data.get("isActive") === "true",
    checklist: data.getAll("checklist"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(routineData),
    },
  );

  if ([400, 409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return await response.json();
}
