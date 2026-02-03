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

  // Fetch available attributes
  const attributesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-attributes`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );
  const availableAttributes = await attributesResponse.json();

  return {
    deviceType,
    availableAttributes,
  };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const attributesJson = data.get("attributes");
  const attributes = attributesJson ? JSON.parse(attributesJson) : [];

  const deviceTypeData = {
    name: data.get("name"),
    description: data.get("description"),
    isActive: data.get("isActive") === "true",
    attributes: attributes,
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
