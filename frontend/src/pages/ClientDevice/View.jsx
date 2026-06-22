import { useLoaderData, redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import ViewClientDevice from "../../components/ClientDevice/View";

const ViewClientDevicePage = () => {
  const device = useLoaderData();
  return <ViewClientDevice device={device} />;
};

export default ViewClientDevicePage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${params.id}`,
    { headers: { Authorization: "Bearer " + token } },
  );

  if (!response.ok) throw response;

  const device = await response.json();
  document.title = device.inventoryNumber || "Устройство";
  return device;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const intent = data.get("intent");
  const id = data.get("id");

  if (intent === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/delete/${id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
      },
    );

    if ([409].includes(response.status)) return response;
    if (!response.ok) throw response;

    return redirect("/inventory/client-devices");
  }

  return null;
}
