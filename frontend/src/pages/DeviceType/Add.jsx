import Form from "../../components/DeviceType/Form";
import { getLocalStorageData } from "../../util/auth";

const AddDeviceTypePage = () => {
  return <Form title="Новый тип устройства" />;
};

export default AddDeviceTypePage;

export async function loader() {
  document.title = "Добавить тип устройства";

  const { token } = getLocalStorageData();

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
    availableAttributes,
  };
}

export async function action({ request }) {
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
