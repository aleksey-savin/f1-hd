import { redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import Form from "../../components/User/Form";

const UpdateUserPage = () => {
  return <Form title="Изменение пользователя" />;
};

export default UpdateUserPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();
  if (!token) {
    return redirect("/auth");
  }

  const userResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/users/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  const user = await userResponse.json();

  const companiesResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/companies`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  const companies = await companiesResponse.json();

  const categoriesResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/ticket-categories`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  const categories = await categoriesResponse.json();

  if (!companiesResponse.ok) {
    if (companiesResponse.status === 401 || companiesResponse.status === 402) {
      return redirect("/auth");
    }
    throw Response.json(
      { message: companiesResponse.message },
      {
        status: companiesResponse.status,
      }
    );
  } else if (!categoriesResponse.ok) {
    if (
      categoriesResponse.status === 401 ||
      categoriesResponse.status === 402
    ) {
      return redirect("/auth");
    }
    throw Response.json(
      { message: categoriesResponse.message },
      {
        status: categoriesResponse.status,
      }
    );
  } else {
    return {
      user: user,
      companiesList: companies,
      categoriesList: categories,
    };
  }
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const userData = {
    email: data.get("email"),
    phone: data.get("phone"),
    firstName: data.get("firstName"),
    lastName: data.get("lastName"),
    position: data.get("position"),
    password: data.get("password"),
    sendPassword: data.get("sendPassword") === "true",
    isActive: data.get("isActive") === "true",
    getScreenApi: data.get("getScreenApi"),
    isAdmin: data.get("isAdmin") === "true",
    isEndUser: data.get("isEndUser") === "true",
    isServiceAccount: data.get("isServiceAccount") === "true",
    isCloudTelephony: data.get("isCloudTelephony") === "true",
    permissions: {
      // ticket workflow
      canPerformTickets: data.get("canPerformTickets") === "true",
      canAdministrateTickets: data.get("canAdministrateTickets") === "true",
      canSeeAllCompanyTickets: data.get("canSeeAllCompanyTickets") === "true",
      canSeeAllTickets: data.get("canSeeAllTickets") === "true",
      canEditTickets: data.get("canEditTickets") === "true",
      canDeleteTickets: data.get("canDeleteTickets") === "true",
      // portal administration
      canManageCompanies: data.get("canManageCompanies") === "true",
      canManageUsers: data.get("canManageUsers") === "true",
      canManageTicketCategories:
        data.get("canManageTicketCategories") === "true",
      canManageRoutineTasks: data.get("canManageRoutineTasks") === "true",
      canUpdateChangelog: data.get("canUpdateChangelog") === "true",
      canManageTicketTemplates: data.get("canManageTicketTemplates") === "true",
      // time tracking module
      canUseTimeTrackingModule: data.get("canUseTimeTrackingModule"),
      canAvoidWorks: data.get("canAvoidWorks") === "true",
      canSeeWorksReport: data.get("canSeeWorksReport") === "true",
      // inventory module
      canUseInventoryModule: data.get("canUseInventoryModule"),
      canManageClientDevices: data.get("canManageClientDevices"),
      canManageMikrotikDevices: data.get("canManageMikrotikDevices"),
      // finance module
      canUseFinancesModule: data.get("canUseFinancesModule"),
      canManageServicePlans: data.get("canManageServicePlans"),
      canSeeGlobalFinancialReport: data.get("canSeeGlobalFinancialReport"),
      canConfirmReportActions: data.get("canConfirmReportActions"),
      canSeePersonalFinancialReport: data.get("canSeePersonalFinancialReport"),
    },
    dashboard: {
      isActive: data.get("dashboardIsActive") === "true",
      personalActions: data.get("dashboardPersonalActions") === "true",
      personalTasks: data.get("dashboardPersonalTasks") === "true",
      personalStats: data.get("dashboardPersonalStats") === "true",
      globalActions: data.get("dashboardGlobalActions") === "true",
      globalTasks: data.get("dashboardGlobalTasks") === "true",
      globalStats: data.get("dashboardGlobalStats") === "true",
    },
    company: data.get("company"),
    subdivision: data.get("subdivision"),
    role: data.get("role"),
    categories: data.getAll("categories"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/users/update/${params.id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(userData),
    }
  );

  if (response.status === 409) {
    return response.json();
  }

  if (!response.ok) {
    throw Response.json(
      { message: "Не удалось изменить пользователя" },
      { status: 500 }
    );
  }

  return await response.json();
}
