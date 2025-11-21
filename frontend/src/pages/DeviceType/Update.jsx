import Form from "../../components/DeviceType/Form";
import { getLocalStorageData } from "../../util/auth";

const UpdateDeviceTypePage = () => {
  return <Form title="Изменение типа устройства" />;
};

export default UpdateDeviceTypePage;

export async function loader({ params }) {
  document.title = "Редактировать тип устройства";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response.json();
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const deviceTypeData = {
    name: data.get("name"),
    description: data.get("description"),
    isActive: data.get("isActive") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(deviceTypeData),
    },
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return await response.json();
}
