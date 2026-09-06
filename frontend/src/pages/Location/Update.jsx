import { api } from "@/lib/api";
import { load } from "@/store/form-data";
import { useLoaderData } from "react-router";

import Form from "../../components/Location/Form";

const UpdateLocationPage = () => {
  const loaderData = useLoaderData();

  return (
    <div>
      <Form
        location={loaderData.location}
        parentLocations={loaderData.parentLocations}
        companies={loaderData.companies}
        users={loaderData.users}
        subdivisions={loaderData.subdivisions}
      />
    </div>
  );
};

export default UpdateLocationPage;

export const loader = async ({ params }) => {
  if (!params.id) {
    throw new Error("Location ID is required for editing");
  }

  try {
    // Справочники — из кэша (store/form-data); само расположение — свежее.
    // Пользователи — только активные: отключённых на назначение не предлагаем
    const [parentLocations, companies, usersData, locationData] =
      await Promise.all([
        load("/api/inventory/locations"),
        load("/api/companies"),
        load("/api/users?activeOnly=true"),
        api(`/api/inventory/locations/${params.id}`),
      ]);
    const users = usersData.users || [];
    const location = locationData.location;

    let subdivisions = [];
    // If location has a company, fetch its subdivisions
    if (location?.company) {
      try {
        const companyData = await api(
          `/api/companies/${location.company?._id}`,
        );
        subdivisions = companyData.company?.subdivisions || [];
      } catch (error) {
        console.error("Error fetching subdivisions:", error);
      }
    }

    return {
      location,
      parentLocations,
      companies,
      users,
      subdivisions,
    };
  } catch (error) {
    console.error("Error in location form loader:", error);
    return {
      location: null,
      parentLocations: [],
      companies: [],
      users: [],
      subdivisions: [],
    };
  }
};

// Action function for React Router
export const action = async ({ request, params }) => {
  const formData = await request.formData();

  const locationData = {
    name: formData.get("name"),
    type: formData.get("type"),
    company: formData.get("company"),
    // subdivisions в модели — массив; форма выбирает одно (hidden input) →
    // getAll даёт [] или [id]
    subdivisions: formData.getAll("subdivisions").filter(Boolean),
    parent: formData.get("parentLocation") || undefined,
    assignedUser: formData.get("assignedUser") || undefined,
    description: formData.get("description"),
    address: formData.get("address"),
    isPublic: formData.get("isPublic") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(locationData),
    },
  );

  if ([409, 400].includes(response.status)) {
    const errorData = await response.json();
    return {
      error: true,
      message: errorData.message,
    };
  }

  if (!response.ok) {
    throw response;
  }

  return await response.json();
};
