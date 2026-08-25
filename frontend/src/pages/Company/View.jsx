import { useLoaderData, redirect } from "react-router";


import ViewCompany from "../../components/Company/View";
import { api } from "@/lib/api";

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
  const headers = {
  };

  // These requests are independent of one another, so fire them in
  // parallel instead of awaiting each in sequence.
  // Статистика — второстепенная: её сбой не должен ронять страницу, поэтому
  // запрос самодостаточно резолвится в распарсенный объект или null.
  // Свои эффективные права знает только /api/me: карточка пользователя отдаёт
  // сырые флаги документа, а с ролями их там нет. Заодно ушёл лишний запрос —
  // `/api/users/:id` здесь тянули ровно ради одной галочки.
  const [me, companyResponse, initialPrefsResponse, stats] =
    await Promise.all([
      api("/api/me").catch(() => null),
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/companies/${params.id}`, {
        headers,
      }),
      fetch(`${import.meta.env.VITE_API_ADDRESS}/api/preferences-initial`, {
        headers,
      }),
      fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/companies/${params.id}/stats`,
        {
          headers,
        },
      )
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ]);

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

  // Плоской карты прав больше нет — спрашиваем словарём, тем же, что сервер
  const canUseFinances = Boolean(
    me?.statements?.servicePlan?.includes("read"),
  );

  if (prefsData.modules.finances.isActive && canUseFinances) {
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

  document.title = `Просмотр ${companyData?.company.alias}`;

  return {
    company: companyData.company,
    servicePlans: companyData.servicePlans,
    servicePlansList: servicePlansData,
    stats,
  };
}

export async function action({ request }) {
  const data = await request.formData();
  const intent = data.get("intent");
  const id = data.get("id");

  if (intent === "addServicePlan") {
    const date = new Date(data.get("isActiveSince"));

    const newServicePlan = {
      plan: data.get("servicePlan"),
      isActiveSince: date,
      customerApprovalRequired: data.get("customerApprovalRequired") === "true",
      subdivisionApprovalRequired:
        data.get("subdivisionApprovalRequired") === "true",
      approverId: data.get("approverId") || null,
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/add-service-plan/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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

  // Правка условий уже подключённой услуги: сама услуга и её тариф общие для
  // всех компаний, здесь меняются только условия привязки
  if (intent === "updateServicePlan") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/service-plan/${id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          servicePlanId: data.get("servicePlanId"),
          isActiveSince: data.get("isActiveSince"),
          customerApprovalRequired:
            data.get("customerApprovalRequired") === "true",
          subdivisionApprovalRequired:
            data.get("subdivisionApprovalRequired") === "true",
          approverId: data.get("approverId") || null,
        }),
      },
    );

    if ([400, 404].includes(response.status)) {
      return response.json();
    }
    if (!response.ok) {
      throw response;
    }
    // Не redirect: диалог закрывается по ответу фетчера, а на редиректе
    // fetcher.data остаётся пустым и модал повисает открытым.
    // Лоадер карточки перечитается сам — фетчер-сабмит ревалидирует его.
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

  if (intent === "toggle-active") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/toggle-active/${id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    // 409 — гард «компании по умолчанию»: тело с message показывает тост карточки
    if (response.status === 409) {
      return response;
    }

    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось изменить статус компании" },
        { status: 500 },
      );
    }

    // Остаёмся на карточке — loader перечитает свежий статус
    return redirect(`/companies/${id}`);
  }

  if (intent === "addSubdivision") {
    const parentId = data.get("parentId") || undefined;

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/add-subdivision`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email") || undefined,
          phone: data.get("phone") || undefined,
          address: data.get("address") || undefined,
          linkToMap: data.get("linkToMap"),
          companyId: data.get("companyId"),
          parentId: parentId,
          // Пустая строка = наследовать пояс родителя/компании
          timezone: data.get("timezone") || null,
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
        },
        body: JSON.stringify({
          subdivisionId: data.get("subdivisionId"),
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone"),
          address: data.get("address"),
          linkToMap: data.get("linkToMap"),
          parentId: data.get("parentId"),
          timezone: data.get("timezone") || null,
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

  if (intent === "reissueApiKey") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/reissue-api-key`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: data.get("companyId"),
          keyId: data.get("keyId"),
        }),
      },
    );

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
