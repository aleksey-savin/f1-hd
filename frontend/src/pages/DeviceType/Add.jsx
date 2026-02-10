import Form from "../../components/DeviceType/Form";
import { getLocalStorageData } from "../../util/auth";

const AddDeviceTypePage = () => {
  return <Form title="Новый тип устройства" />;
};

export default AddDeviceTypePage;

export async function loader() {
  document.title = "Добавить тип устройства";

  const { token } = getLocalStorageData();

  // Fetch all device types for attachableToTypeIds selection
  const deviceTypesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );
  const availableDeviceTypes = await deviceTypesResponse.json();

  return {
    availableDeviceTypes,
  };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const deviceTypeData = {
    name: data.get("name"),
    isActive: data.get("isActive") === "true",
    isComponent: data.get("isComponent") === "true",
    isConsumable: data.get("isConsumable") === "true",
    attachableToTypeIds: data.getAll("attachableToTypeIds"),
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
