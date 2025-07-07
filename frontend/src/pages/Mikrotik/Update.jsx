import { redirect } from "react-router";

import UpdateMikrotikDeviceInfo from "../../components/Devices/Mikrotik/UpdateModal";
import { getLocalStorageData } from "../../util/auth";

const UpdateMikrotikDevicePage = () => {
  return <UpdateMikrotikDeviceInfo />;
};

export default UpdateMikrotikDevicePage;

export async function loader({ params }) {
  document.title = "ИЗМЕНИТЬ УСТРОЙСТВО MIKROTIK";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/mikrotik-devices/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const deviceData = {
    _id: data.get("_id"),
    description: data.get("description"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/mikrotik-devices/update-info`,
    {
      method: "PATCH",
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
