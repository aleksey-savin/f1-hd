import Form from "../../components/DeviceConfiguration/Form";

const AddDeviceConfigurationPage = () => {

  return <Form title="Новая конфигурация" />;
};

export default AddDeviceConfigurationPage;

export async function loader({ params }) {
  document.title = "Новая конфигурация";

  // Fetch device model
  const deviceModelResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/${params.id}`,
      );

  if (!deviceModelResponse.ok) {
    throw deviceModelResponse;
  }

  const deviceModel = await deviceModelResponse.json();

  // Fetch device type with attributes
  const deviceTypeResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/${deviceModel.deviceTypeId._id}`,
      );

  const deviceType = await deviceTypeResponse.json();
  const attributes = deviceType.attributes || [];

  return {
    deviceModel,
    attributes,
  };
}

export async function action({ request, params }) {
  const data = await request.formData();

  const valuesJson = data.get("values");
  const values = valuesJson ? JSON.parse(valuesJson) : [];

  const configurationData = {
    deviceModelId: params.id,
    values,
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(configurationData),
    },
  );

  if (!response.ok) {
    throw response;
  }

  return { ok: true };
}
