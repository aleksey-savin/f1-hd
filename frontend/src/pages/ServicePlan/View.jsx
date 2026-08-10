import { useLoaderData, redirect } from "react-router";


import ViewServicePlan from "../../components/ServicePlan/View";

const ViewServicePlanPage = () => {
  const { servicePlan } = useLoaderData();
  return <ViewServicePlan servicePlan={servicePlan} />;
};

export default ViewServicePlanPage;

export async function loader({ params }) {
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/finances/service-plans/${params.id}`,
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
  const data = await request.formData();
  const intent = data.get("intent");
  const id = data.get("id");

  if (intent === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/service-plans/delete/${id}`,
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

    return redirect("/finances/service-plans");
  }
}
