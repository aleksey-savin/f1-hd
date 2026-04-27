import { useContext } from "react";
import DeviceModelForm from "../../components/DeviceModel/Form";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";
import { useSearchParams } from "react-router";

const UpdateDeviceModelPage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageClientDevices } = permissions;
  const [searchParams] = useSearchParams();
  const configId = searchParams.get("configId");

  return (
    <>
      {canUseInventoryModule && canManageClientDevices && (
        <DeviceModelForm
          title="Редактировать модель устройства"
          editConfigId={configId}
        />
      )}
      {(!canUseInventoryModule || !canManageClientDevices) && <Forbidden />}
    </>
  );
};

export default UpdateDeviceModelPage;

export async function loader({ params }) {
  document.title = "Редактировать модель устройства";

  const { token } = getLocalStorageData();

  // Fetch device model
  const deviceModelResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/${params.id}`,
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

  // Fetch device types with attributes
  const deviceTypesResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );
  let deviceTypes = await deviceTypesResponse.json();

  // Fetch attributes for each device type
  for (let dt of deviceTypes) {
    const dtResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/${dt._id}`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );
    const fullDeviceType = await dtResponse.json();
    dt.attributes = fullDeviceType.attributes || [];
  }

  // Fetch vendors
  const vendorsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );
  const vendors = await vendorsResponse.json();

  // Fetch all device models for compatibility selection (exclude current one)
  const deviceModelsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );
  const allDeviceModels = await deviceModelsResponse.json();
  const deviceModels = allDeviceModels.filter((dm) => dm._id !== params.id);

  // Fetch configurations for this model
  const configurationsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/model/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  const configurations = configurationsResponse.ok
    ? await configurationsResponse.json()
    : [];

  return {
    deviceModel,
    deviceTypes,
    vendors,
    deviceModels,
    configurations,
  };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const configurationsJson = data.get("configurations");
  const configurations = configurationsJson
    ? JSON.parse(configurationsJson)
    : [];

  const deviceModelData = {
    deviceTypeId: data.get("deviceTypeId"),
    vendorId: data.get("vendorId"),
    name: data.get("name"),
    compatibleWithModelIds: data.getAll("compatibleWithModelIds"),
    notes: data.get("notes"),
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(deviceModelData),
    },
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  const result = await response.json();

  // Handle configuration updates/additions
  if (configurations.length > 0) {
    for (const config of configurations) {
      if (config._id) {
        // Update existing configuration
        await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/update/${config._id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({
              deviceModelId: params.id,
              values: config.values,
            }),
          },
        );
      } else {
        // Create new configuration
        await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-configurations/add`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({
              deviceModelId: params.id,
              values: config.values,
            }),
          },
        );
      }
    }
  }

  return result;
}
