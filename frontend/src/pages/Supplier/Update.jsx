import { useContext } from "react";

import Form from "../../components/Supplier/Form";
import InlineForbidden from "../../components/Error/InlineForbidden";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const UpdateSupplierPage = () => {
  const { permissions } = useContext(AuthedUserContext);

  if (
    !permissions.canUseInventoryModule ||
    !permissions.canManageClientDevices
  ) {
    return <InlineForbidden right="Управление устройствами" />;
  }

  return <Form title="Изменить поставщика" />;
};

export default UpdateSupplierPage;

export async function loader({ params }) {
  document.title = "Изменить поставщика";

  const { token } = getLocalStorageData();
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers/${params.id}`,
    { headers: { Authorization: "Bearer " + token } },
  );

  if (!response.ok) throw response;
  return response;
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();
  const data = await request.formData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        name: data.get("name"),
        phone: data.get("phone") || "",
        email: data.get("email") || "",
        website: data.get("website") || "",
        address: data.get("address") || "",
        inn: data.get("inn") || "",
        kpp: data.get("kpp") || "",
        notes: data.get("notes") || "",
        isActive: data.get("isActive") === "true",
      }),
    },
  );

  if ([409, 422].includes(response.status)) return response;
  if (!response.ok) throw response;

  return await response.json();
}
