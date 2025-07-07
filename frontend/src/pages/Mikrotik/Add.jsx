import { redirect } from "react-router";

import AddMikrotikDevice from "../../components/Devices/Mikrotik/AddModal";
import { getLocalStorageData } from "../../util/auth";

const AddMikrotikDevicePage = () => {
  return <AddMikrotikDevice />;
};

export default AddMikrotikDevicePage;

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const deviceData = {
    host: data.get("host"),
    port: data.get("port"),
    user: data.get("user"),
    password: data.get("password"),
    description: data.get("description"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/mikrotik-devices/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(deviceData),
    },
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return redirect("/devices/mikrotik");
}
