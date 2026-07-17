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
  // Атрибуты типа форме модели больше не нужны (конфигурации — отдельная
  // форма с карточки); тип по-прежнему несёт isConsumable для совместимости.
  const deviceTypes = await deviceTypesResponse.json();

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

  return {
    deviceModel,
    deviceTypes,
    vendors,
    deviceModels,
  };
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

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

  return await response.json();
}
