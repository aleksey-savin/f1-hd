import { useContext } from "react";
import VendorForm from "../../components/Vendor/Form";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const UpdateVendorPage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const { canUseInventoryModule, canManageClientDevices } = permissions;

  return (
    <>
      {canUseInventoryModule && canManageClientDevices && (
        <VendorForm title="Редактировать вендора" />
      )}
      {(!canUseInventoryModule || !canManageClientDevices) && <Forbidden />}
    </>
  );
};

export default UpdateVendorPage;

export async function loader({ params }) {
  document.title = "Редактировать вендора";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors/${params.id}`,
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

  const vendorData = {
    name: data.get("name"),
    isActive: data.get("isActive") === "true",
    isMikrotikManagementEnabled:
      data.get("isMikrotikManagementEnabled") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(vendorData),
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
