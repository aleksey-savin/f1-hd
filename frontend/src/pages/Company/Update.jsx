import { getLocalStorageData } from "../../util/auth";

import CompanyForm from "../../components/Company/Form";

const UpdateCompanyPage = () => {
  return <CompanyForm title="Изменение компании" />;
};

export default UpdateCompanyPage;

export async function loader({ params }) {
  document.title = "ИЗМЕНИТЬ КОМПАНИЮ";

  const { token } = getLocalStorageData();

  const companyResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/companies/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!companyResponse.ok) {
    throw companyResponse;
  }

  const respResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/users/can-perform-tickets`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!respResponse.ok) {
    throw respResponse;
  }

  const companyData = await companyResponse.json();

  return {
    company: companyData.company,
    responsibles: await respResponse.json(),
  };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const schedule = {};

  // Process form data
  for (const [key, value] of data.entries()) {
    const [day, field] = key.split(".");
    if (!schedule[day]) {
      schedule[day] = {
        isWorking: false,
        is24hours: false,
        start: "",
        end: "",
      };
    }
    if (field === "isWorking") {
      schedule[day].isWorking = value === "on";
    } else if (field === "is24hours") {
      schedule[day].is24hours = value === "on";
    } else {
      schedule[day][field] = value;
    }
  }

  const clientsSideRespIds = data.getAll("clientsSideResponsibles");

  const companyData = {
    alias: data.get("alias"),
    fullTitle: data.get("fullTitle"),
    emailDomains: data.get("emailDomains"),
    phones: data.get("phones"),
    address: data.get("address"),
    linkToMap: data.get("linkToMap"),
    responsibles: data.getAll("responsibles"),
    clientsSideResponsibles: clientsSideRespIds[0] ? clientsSideRespIds : [],
    workSchedule: schedule,
  };

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/companies/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(companyData),
    },
  );

  if (!response.ok) {
    throw response;
  }

  return await response.json();
}
