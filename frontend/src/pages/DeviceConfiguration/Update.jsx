import { useContext } from "react";
import Form from "../../components/DeviceConfiguration/Form";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";
import { redirect } from "react-router";

const UpdateDeviceConfigurationPage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageClientDevices } = permissions;

  return (
    <>
      {canUseInventoryModule && canManageClientDevices && (
        <Form title="Редактировать конфигурацию" />
      )}
      {(!canUseInventoryModule || !canManageClientDevices) && <Forbidden />}
    </>
  );
};

export default UpdateDeviceConfigurationPage;

export async function loader({ params }) {
  document.title = "Редактировать конфигурацию";

  const { token } = getLocalStorageData();

  // Fetch configuration
  const configurationResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!configurationResponse.ok) {
    throw configurationResponse;
  }

  const configuration = await configurationResponse.json();

  // Fetch device model
  const deviceModelResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/${configuration.deviceModelId._id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!deviceModelResponse.ok) {
    throw deviceModelResponse;
  }

  const deviceModel = await deviceModelResponse.json();

  // Fetch device type with attributes
  const deviceTypeResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/${deviceModel.deviceTypeId._id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
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
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const valuesJson = data.get("values");
  const values = valuesJson ? JSON.parse(valuesJson) : [];
  const deviceModelId = data.get("deviceModelId");

  const configurationData = {
    deviceModelId,
    values,
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(configurationData),
    },
  );

  if (!response.ok) {
    throw response;
  }

  return redirect(`/inventory/device-models/${deviceModelId}`);
}
