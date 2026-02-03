import { useContext } from "react";
import DeviceAttributeForm from "../../components/DeviceAttribute/Form";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const UpdateDeviceAttributePage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageDeviceAttributes } = permissions;

  return (
    <>
      {canUseInventoryModule && canManageDeviceAttributes && (
        <DeviceAttributeForm title="Редактировать атрибут устройства" />
      )}
      {(!canUseInventoryModule || !canManageDeviceAttributes) && <Forbidden />}
    </>
  );
};

export default UpdateDeviceAttributePage;

export async function loader({ params }) {
  document.title = "Редактировать атрибут устройства";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-attributes/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const options = data.get("options");
  const optionsArray = options
    ? options
        .split("\n")
        .map((opt) => opt.trim())
        .filter(Boolean)
    : [];

  const attributeData = {
    name: data.get("name"),
    label: data.get("label"),
    description: data.get("description"),
    dataType: data.get("dataType"),
    unit: data.get("unit"),
    options: optionsArray,
    isActive: data.get("isActive") === "on",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-attributes/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(attributeData),
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
