import { api } from "@/lib/api";
import { load } from "@/store/form-data";
import Form from "../../components/TicketCategory/Form";

const UpdateTicketCategoryPage = () => {
  return <Form title="Изменить категорию заявок" />;
};

export default UpdateTicketCategoryPage;

export async function loader({ params }) {
  document.title = "Изменить категорию заявок";

  // Категория — всегда свежая; справочники — из кэша (store/form-data);
  // услуги — только при включённом модуле финансов
  const [categoryData, prefsData, usersData] = await Promise.all([
    api(`/api/ticket-categories/${params.id}`),
    load("/api/preferences-initial"),
    load("/api/users/can-perform-tickets"),
  ]);
  const servicePlansData = prefsData.modules.finances.isActive
    ? await load("/api/finances/service-plans/")
    : [];

  return {
    ticketCategory: categoryData,
    servicePlansList: servicePlansData,
    usersList: usersData,
  };
}

export async function action({ request, params }) {
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
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories/update/${params.id}`,
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
