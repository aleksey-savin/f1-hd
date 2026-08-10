import Form from "../../components/TicketCategory/Form";

const AddTicketCategoryPage = () => {
  return <Form title="Новая категория заявок" />;
};

export default AddTicketCategoryPage;

export async function loader() {
  document.title = "Новая категория заявок";

  const initialPrefsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences-initial`,
      );

  if (!initialPrefsResponse.ok) {
    throw initialPrefsResponse;
  }

  const prefsData = await initialPrefsResponse.json();

  let servicePlansData = [];

  if (prefsData.modules.finances.isActive) {
    const servicePlansResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/service-plans/`,
          );

    if (!servicePlansResponse.ok) {
      throw servicePlansResponse;
    }

    servicePlansData = await servicePlansResponse.json();
  }

  const usersResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/can-perform-tickets`,
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
  const data = await request.formData();

  const categoryData = {
    title: data.get("title"),
    description: data.get("description"),
    users: data.getAll("users"),
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
      },
      body: JSON.stringify(categoryData),
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
