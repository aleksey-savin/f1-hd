import { useLoaderData, redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import ViewServicePlan from "../../components/ServicePlan/View";

const ViewServicePlanPage = () => {
  const { servicePlan } = useLoaderData();
  return <ViewServicePlan servicePlan={servicePlan} />;
};

export default ViewServicePlanPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/service-plans/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  const servicePlan = await response.json();

  document.title = `${servicePlan.title.toUpperCase()}`;

  return {
    servicePlan: servicePlan,
  };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const intent = data.get("intent");
  const id = data.get("id");

  if (intent === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/service-plans/delete/${id}`,
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

    return redirect("/finances/service-plans");
  }
}
