import { useLoaderData } from "react-router";

import { getLocalStorageData } from "../../util/auth";

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
  const { token } = getLocalStorageData();
  const url = new URL(request.url);
  const companyParam = url.searchParams.get("company");
  const parentParam = url.searchParams.get("parent");

  const [companiesResponse, parentLocationsResponse, usersResponse] =
    await Promise.all([
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/companies`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/users?activeOnly=true`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

  const companies = await companiesResponse.json();
  const parentLocations = parentLocationsResponse.ok
    ? await parentLocationsResponse.json()
    : [];
  const usersData = usersResponse.ok ? await usersResponse.json() : {};
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
  const { token } = getLocalStorageData();
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
        Authorization: "Bearer " + token,
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
