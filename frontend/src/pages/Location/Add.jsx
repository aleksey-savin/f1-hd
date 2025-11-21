import { useLoaderData } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import Form from "../../components/Location/Form";

const AddLocationPage = () => {
  const { companies, preselectedCompany } = useLoaderData();
  return (
    <div>
      <Form companies={companies} preselectedCompany={preselectedCompany} />
    </div>
  );
};

export default AddLocationPage;

export async function loader({ request }) {
  const { token } = getLocalStorageData();
  const url = new URL(request.url);
  const companyParam = url.searchParams.get("company");

  const companiesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/companies`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const companies = await companiesResponse.json();

  return {
    companies,
    preselectedCompany: companyParam || null,
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
    subdivision: formData.get("subdivision") || undefined,
    parent: formData.get("parentLocation") || undefined,
    assignedUser: formData.get("assignedUser") || undefined,
    description: formData.get("description"),
    address: formData.get("address"),
    floor: formData.get("floor") ? parseInt(formData.get("floor")) : null,
    coordinates: formData.get("coordinates") || null,
    isPublic: formData.get("isPublic") === "on",
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
