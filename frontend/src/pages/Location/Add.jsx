import { load } from "@/store/form-data";
import { useLoaderData } from "react-router";


import Form from "../../components/Location/Form";

const AddLocationPage = () => {
  const {
    companies,
    parentLocations,
    users,
    preselectedCompany,
    preselectedParent,
  } = useLoaderData();
  return (
    <div>
      <Form
        companies={companies}
        parentLocations={parentLocations}
        users={users}
        preselectedCompany={preselectedCompany}
        preselectedParent={preselectedParent}
        // Создание → карточка созданного расположения (навигация после
        // сабмита, гайд)
        successTo={(data) =>
          data?.location?._id
            ? `/inventory/locations/${data.location._id}`
            : undefined
        }
      />
    </div>
  );
};

export default AddLocationPage;

export async function loader({ request }) {
  const url = new URL(request.url);
  const companyParam = url.searchParams.get("company");
  const parentParam = url.searchParams.get("parent");

  // Справочники — из кэша (store/form-data)
  const [companies, parentLocations, usersData] = await Promise.all([
    load("/api/companies"),
    load("/api/inventory/locations").catch(() => []),
    load("/api/users?activeOnly=true").catch(() => ({})),
  ]);
  const users = usersData.users || [];

  return {
    companies,
    parentLocations,
    users,
    preselectedCompany: companyParam || null,
    preselectedParent: parentParam || null,
  };
}

// Action function for React Router
export const action = async ({ request }) => {
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
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations/add`,
    {
      method: "POST",
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
