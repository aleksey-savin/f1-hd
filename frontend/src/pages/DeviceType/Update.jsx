import Form from "../../components/DeviceType/Form";
import { getLocalStorageData } from "../../util/auth";

const UpdateDeviceTypePage = () => {
  return <Form title="Изменение типа устройства" />;
};

export default UpdateDeviceTypePage;

export async function loader({ params }) {
  document.title = "Редактировать тип устройства";

  const { token } = getLocalStorageData();

  // Fetch device type
  const deviceTypeResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!deviceTypeResponse.ok) {
    throw deviceTypeResponse;
  }

  const deviceType = await deviceTypeResponse.json();

  // Fetch all device types for attachableToTypeIds selection
  const deviceTypesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );
  const allDeviceTypes = await deviceTypesResponse.json();

  // Filter out current device type from available options
  const availableDeviceTypes = allDeviceTypes.filter(
    (dt) => dt._id !== params.id,
  );

  return {
    deviceType,
    availableDeviceTypes,
  };
}

export async function action({ request, params }) {
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
