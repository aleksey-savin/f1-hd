import { useContext } from "react";
import DeviceModelForm from "../../components/DeviceModel/Form";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const UpdateDeviceModelPage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageDeviceModels } = permissions;

  return (
    <>
      {canUseInventoryModule && canManageDeviceModels && (
        <DeviceModelForm title="Редактировать модель устройства" />
      )}
      {(!canUseInventoryModule || !canManageDeviceModels) && <Forbidden />}
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
    }
  );
  const deviceModel = await deviceModelResponse.json();

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
    deviceModel,
    deviceTypes,
    vendors,
  };
}

export async function action({ request, params }) {
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
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/update/${params.id}`,
    {
      method: "PUT",
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
