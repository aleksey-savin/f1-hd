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

  // Fetch all device attributes
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
    availableDeviceTypes,
    availableAttributes: availableAttributes.map((attribute) => ({
      _id: attribute._id,
      name: attribute.name,
      code: attribute.code,
    })),
  };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  // Collect attributes
  const attributes = [];
  let index = 0;
  while (data.get(`attributes[${index}].attributeId`)) {
    const attributeId = data.get(`attributes[${index}].attributeId`);
    const required = data.get(`attributes[${index}].required`) === "on";
    const extendable = data.get(`attributes[${index}].extendable`) === "on";
    if (attributeId) {
      attributes.push({ attributeId, required, extendable });
    }
    index++;
  }

  const deviceTypeData = {
    name: data.get("name"),
    isActive: data.get("isActive") === "true",
    isComponent: data.get("isComponent") === "true",
    isConsumable: data.get("isConsumable") === "true",
    isPeripheral: data.get("isPeripheral") === "true",
    inventoryPrefix: data.get("inventoryPrefix"),
    attachableToTypeIds: data.getAll("attachableToTypeIds"),
    attributes,
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
