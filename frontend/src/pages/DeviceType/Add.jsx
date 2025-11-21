import Form from "../../components/DeviceType/Form";
import { getLocalStorageData } from "../../util/auth";

const AddDeviceTypePage = () => {
  return <Form title="Новый тип устройства" />;
};

export default AddDeviceTypePage;

export async function loader() {
  document.title = "Добавить тип устройства";
  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const deviceTypeData = {
    name: data.get("name"),
    description: data.get("description"),
    isActive: data.get("isActive") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/add`,
    {
      method: "POST",
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
