import Form from "../../components/DeviceModel/Form";
import { getLocalStorageData } from "../../util/auth";

const AddDeviceModelPage = () => {
  return <Form title="Новая модель устройства" />;
};

export default AddDeviceModelPage;

export async function loader() {
  document.title = "Добавить модель устройства";

  const { token } = getLocalStorageData();

  // Fetch device types
  const deviceTypesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );
  const deviceTypes = await deviceTypesResponse.json();

  // Fetch vendors
  const vendorsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );
  const vendors = await vendorsResponse.json();

  return {
    deviceTypes,
    vendors,
  };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const attributesJson = data.get("attributes");
  const attributes = attributesJson ? JSON.parse(attributesJson) : [];

  const deviceModelData = {
    deviceTypeId: data.get("deviceTypeId"),
    vendorId: data.get("vendorId"),
    name: data.get("name"),
    attributes: attributes,
    notes: data.get("notes"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(deviceModelData),
    }
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return await response.json();
}
