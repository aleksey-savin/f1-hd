import Form from "../../components/DeviceConfiguration/Form";

const UpdateDeviceConfigurationPage = () => {

  return <Form title="Изменить конфигурацию" />;
};

export default UpdateDeviceConfigurationPage;

export async function loader({ params }) {
  document.title = "Изменить конфигурацию";

  // Fetch configuration
  const configurationResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/${params.configId}`,
      );

  if (!configurationResponse.ok) {
    throw configurationResponse;
  }

  const configuration = await configurationResponse.json();

  // Fetch device model
  const deviceModelResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/${configuration.deviceModelId._id}`,
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
    configuration,
    deviceModel,
    attributes,
  };
}

export async function action({ request, params }) {
  const data = await request.formData();

  const valuesJson = data.get("values");
  const values = valuesJson ? JSON.parse(valuesJson) : [];
  const deviceModelId = data.get("deviceModelId");

  const configurationData = {
    deviceModelId,
    values,
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/update/${params.configId}`,
    {
      method: "PUT",
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
