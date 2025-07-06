import CompanyForm from "../../components/Company/Form";
import { getLocalStorageData } from "../../util/auth";

const AddCompanyPage = () => {
  return <CompanyForm title="Новая компания" />;
};

export default AddCompanyPage;

export async function loader() {
  document.title = "НОВАЯ КОМПАНИЯ";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/users/can-perform-tickets`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return {
    responsibles: await response.json(),
  };
}

export async function action({ request }) {
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
        start: "09:00",
        end: "18:00",
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

  const companyData = {
    alias: data.get("alias"),
    fullTitle: data.get("fullTitle"),
    emailDomains: data.get("emailDomains"),
    phones: data.get("phones"),
    address: data.get("address"),
    linkToMap: data.get("linkToMap"),
    responsibles: data.getAll("responsibles"),
    workSchedule: schedule,
  };

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/companies/add`,
    {
      method: "POST",
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
