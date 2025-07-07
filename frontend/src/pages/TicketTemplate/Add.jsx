import { useLoaderData } from "react-router";

import Form from "../../components/TicketCategory/Form";
import { getLocalStorageData } from "../../util/auth";

const AddTicketTemplatePage = () => {
  const { servicePlansList, usersList } = useLoaderData();
  return (
    <Form
      title="Новый шаблон заявки"
      servicePlansList={servicePlansList}
      usersList={usersList}
    />
  );
};

export default AddTicketTemplatePage;

export async function loader() {
  const { token } = getLocalStorageData();

  document.title = "ДОБАВИТЬ ШАБЛОН ЗАЯВКИ";

  const initialPrefsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences-initial`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!initialPrefsResponse.ok) {
    throw initialPrefsResponse;
  }

  const prefsData = await initialPrefsResponse.json();

  let servicePlansData = [];

  if (prefsData.modules.finances.isActive) {
    const servicePlansResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/service-plans/`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!servicePlansResponse.ok) {
      throw servicePlansResponse;
    }

    servicePlansData = await servicePlansResponse.json();
  }

  const usersResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/can-perform-tickets`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!usersResponse.ok) {
    throw usersResponse;
  }

  const usersData = await usersResponse.json();

  return {
    servicePlansList: servicePlansData,
    usersList: usersData,
  };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const category = data.get("category");

  const templateData = {
    title: data.get("title"),
    description: data.get("description"),
    categoryId: category?._id,
    sharedUsers: data.getAll("sharedUsers"),
    sharedCompanies: data.getAll("sharedCompanies"),
    servicePlans: data.getAll("servicePlans"),
    isActive: data.get("isActive") === "true",
    alwaysWithinPlan: data.get("alwaysWithinPlan") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(templateData),
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
