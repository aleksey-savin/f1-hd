import { useLoaderData, redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import ViewCompany from "../../components/Company/View";

const ViewCompanyPage = () => {
  const { company, servicePlans, servicePlansList, stats } = useLoaderData();
  return (
    <ViewCompany
      company={company}
      servicePlans={servicePlans}
      servicePlansList={servicePlansList}
      stats={stats}
    />
  );
};

export default ViewCompanyPage;

export async function loader({ params }) {
  const { token, userId } = getLocalStorageData();

  const headers = {
    Authorization: "Bearer " + token,
  };

  // These requests are independent of one another, so fire them in
  // parallel instead of awaiting each in sequence.
  // Статистика — второстепенная: её сбой не должен ронять страницу, поэтому
  // запрос самодостаточно резолвится в распарсенный объект или null.
  const [userResponse, companyResponse, initialPrefsResponse, stats] =
    await Promise.all([
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/users/${userId}`, {
        headers,
      }),
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/companies/${params.id}`, {
        headers,
      }),
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/preferences-initial`, {
        headers,
      }),
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/companies/${params.id}/stats`, {
        headers,
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ]);

  const user = await userResponse.json();

  if (!companyResponse.ok) {
    throw companyResponse;
  }

  const companyData = await companyResponse.json();

  // Helper function to get users from other subdivisions
  const getUsersFromOtherSubdivisions = (subdivisions) => {
    let usersInOtherSubdivisions = {};

    const processSubdivision = (subdivision) => {
      if (subdivision.manager) {
        usersInOtherSubdivisions[subdivision.manager._id] = {
          subdivisionName: subdivision.name,
          role: "manager",
          subdivisionId: subdivision._id, // Add subdivision ID
        };
      }
      if (subdivision.users) {
        subdivision.users.forEach((user) => {
          usersInOtherSubdivisions[user._id] = {
            subdivisionName: subdivision.name,
            role: "user",
            subdivisionId: subdivision._id, // Add subdivision ID
          };
        });
      }
    };

    const traverse = (items) => {
      items?.forEach((subdivision) => {
        processSubdivision(subdivision);
        if (subdivision.subdivisions?.length) {
          traverse(subdivision.subdivisions);
        }
      });
    };

    traverse(subdivisions);
    return usersInOtherSubdivisions;
  };

  // Add this information to companyData
  companyData.company.usersInSubdivisions = getUsersFromOtherSubdivisions(
    companyData.company.subdivisions,
  );

  if (!initialPrefsResponse.ok) {
    throw initialPrefsResponse;
  }

  const prefsData = await initialPrefsResponse.json();

  let servicePlansData = [];

  if (
    prefsData.modules.finances.isActive &&
    user.permissions.canUseFinancesModule
  ) {
    const servicePlansResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/service-plans/`,
      {
        headers,
      },
    );

    if (!servicePlansResponse.ok) {
      throw servicePlansResponse;
    }

    servicePlansData = await servicePlansResponse.json();
  }

  document.title = `${companyData?.company.alias}`;

  return {
    company: companyData.company,
    servicePlans: companyData.servicePlans,
    servicePlansList: servicePlansData,
    stats,
  };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const intent = data.get("intent");
  const id = data.get("id");

  if (intent === "addServicePlan") {
    const date = new Date(data.get("isActiveSince"));

    const newServicePlan = {
      plan: data.get("servicePlan"),
      isActiveSince: date,
      customerApprovalRequired: data.get("customerApprovalRequired") === "true",
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/add-service-plan/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(newServicePlan),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "deleteServicePlan") {
    const servicePlanId = data.get("servicePlanId");
    const companyId = data.get("companyId");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/delete-service-plan/${companyId}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ servicePlanId: servicePlanId }),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/delete/${id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return redirect("/companies");
  }

  if (intent === "addSubdivision") {
    const parentId = data.get("parentId") || undefined;

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/add-subdivision`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email") || undefined,
          phone: data.get("phone") || undefined,
          address: data.get("address") || undefined,
          linkToMap: data.get("linkToMap"),
          companyId: data.get("companyId"),
          parentId: parentId,
        }),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "updateSubdivision") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/update-subdivision`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          subdivisionId: data.get("subdivisionId"),
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone"),
          address: data.get("address"),
          linkToMap: data.get("linkToMap"),
          parentId: data.get("parentId"),
        }),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "deleteSubdivision") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/delete-subdivision`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          subdivisionId: data.get("subdivisionId"),
          companyId: data.get("companyId"),
        }),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "updateSubdivisionUsers") {
    const subdivisionId = data.get("subdivisionId");

    const managerValue = data.get("manager");
    const manager = [null, "", "null"].includes(managerValue)
      ? null
      : managerValue;

    const usersValue = data.get("users");
    const users = usersValue
      ? usersValue.split(",").filter(Boolean) // Removes empty strings
      : [];

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/update-subdivision-users`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          subdivisionId,
          manager,
          users: users,
        }),
      },
    );

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "createApiKey") {
    const companyId = data.get("companyId");
    const keyName = data.get("keyName");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/create-api-key`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          companyId,
          keyName,
        }),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "deleteApiKey") {
    const companyId = data.get("companyId");
    const keyId = data.get("keyId");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/delete-api-key`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          companyId,
          keyId,
        }),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "linkUserToAD") {
    const userId = data.get("userId");
    const activeDirectoryObjectGUID = data.get("activeDirectoryObjectGUID");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/link-user-to-ad`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          userId,
          activeDirectoryObjectGUID,
        }),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "unlinkUserFromAD") {
    const userId = data.get("userId");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/unlink-user-from-ad`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          userId,
        }),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }
}
