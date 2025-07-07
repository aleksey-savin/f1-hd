import ServicePlanForm from "../../components/ServicePlan/Form";
import { getLocalStorageData } from "../../util/auth";

const UpdateServicePlanPage = () => {
  return <ServicePlanForm title="Изменить услугу" />;
};

export default UpdateServicePlanPage;

export async function loader({ params }) {
  document.title = "ИЗМЕНЕНИЕ УСЛУГИ";

  const { token } = getLocalStorageData();

  const servicePlanResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/service-plans/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!servicePlanResponse.ok) {
    throw servicePlanResponse;
  }

  const ticketCategoriesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!ticketCategoriesResponse.ok) {
    throw ticketCategoriesResponse;
  }

  return {
    servicePlan: await servicePlanResponse.json(),
    ticketCategories: await ticketCategoriesResponse.json(),
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
      schedule[day] = { isWorking: false, start: "09:00", end: "18:00" };
    }
    if (field === "isWorking") {
      schedule[day].isWorking = value === "on";
    } else {
      schedule[day][field] = value;
    }
  }

  const packagesData = JSON.parse(data.get("hourPackages"));

  const servicePlanData = {
    title: data.get("title"),
    companyWorkSchedule: data.get("companyWorkSchedule"),
    customProvisionSchedule: schedule,
    ticketCategories: data.getAll("ticketCategories"),
    type: data.get("tariffingType"),
    hourPackages: packagesData,
    fixedPrice: data.get("fixedPrice"),
    pricePerHour: data.get("hourlyPrice"),
    pricePerHourNonWorking: data.get("pricePerHourNonWorking"),
    packagesNonWorkingCalcMethod:
      data.get("packagesNonWorkingCalcMethod") || "separatePayment",
    packagesNonWorkingCoefficient: data.get("packagesNonWorkingCoefficient"),
    tariffingPeriod: data.get("tariffingPeriod"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/service-plans/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(servicePlanData),
    },
  );

  if (!response.ok) {
    throw response;
  }

  const result = await response.json();

  return result;
}
