import { load } from "@/store/form-data";
import Form from "../../components/TicketCategory/Form";

const AddTicketCategoryPage = () => {
  return <Form title="Новая категория заявок" />;
};

export default AddTicketCategoryPage;

export async function loader() {
  document.title = "Новая категория заявок";

  // Справочники — из кэша (store/form-data); услуги — только при включённом
  // модуле финансов
  const [prefsData, usersData] = await Promise.all([
    load("/api/preferences-initial"),
    load("/api/users/can-perform-tickets"),
  ]);
  const servicePlansData = prefsData.modules.finances.isActive
    ? await load("/api/finances/service-plans/")
    : [];

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
