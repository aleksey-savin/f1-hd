import { useLoaderData } from "react-router";
import { getLocalStorageData } from "../../util/auth";

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
  const { token } = getLocalStorageData();

  if (!params.id) {
    throw new Error("Location ID is required for editing");
  }

  try {
    const promises = [];

    // Fetch parent locations
    promises.push(
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations`, {
        headers: {
          Authorization: "Bearer " + token,
        },
      }),
    );

    // Fetch companies
    promises.push(
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/companies`, {
        headers: {
          Authorization: "Bearer " + token,
        },
      }),
    );

    // Fetch users (active only — disabled users aren't offered for assignment)
    promises.push(
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/users?activeOnly=true`, {
        headers: {
          Authorization: "Bearer " + token,
        },
      }),
    );

    // Fetch the location (always required for update page)
    promises.push(
      fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations/${params.id}`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      ),
    );

    const responses = await Promise.all(promises);

    const parentLocationsResponse = responses[0];
    if (!parentLocationsResponse.ok) {
      throw new Error("Failed to fetch parent locations");
    }
    const parentLocations = await parentLocationsResponse.json();

    const companiesResponse = responses[1];
    if (!companiesResponse.ok) {
      throw new Error("Failed to fetch companies");
    }
    const companies = await companiesResponse.json();

    const usersResponse = responses[2];
    if (!usersResponse.ok) {
      throw new Error("Failed to fetch users");
    }
    const usersData = await usersResponse.json();
    const users = usersData.users || [];

    const locationResponse = responses[3];
    if (!locationResponse.ok) {
      throw new Error("Failed to fetch location");
    }
    const locationData = await locationResponse.json();
    const location = locationData.location;

    let subdivisions = [];
    // If location has a company, fetch its subdivisions

    if (location?.company) {
      try {
        const subdivisionResponse = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/companies/${location.company?._id}`,
          {
            headers: { Authorization: "Bearer " + token },
          },
        );
        if (subdivisionResponse.ok) {
          const companyData = await subdivisionResponse.json();
          subdivisions = companyData.company?.subdivisions || [];
        }
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
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations/update/${params.id}`,
    {
      method: "PUT",
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
