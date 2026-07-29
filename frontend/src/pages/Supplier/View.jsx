import { useContext } from "react";
import { redirect, useLoaderData } from "react-router";

import ViewSupplier from "../../components/Supplier/View";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

const ViewSupplierPage = () => {
  const { permissions } = useContext(AuthedUserContext);
  const supplier = useLoaderData();

  if (
    !permissions.canUseInventoryModule ||
    !permissions.canManageClientDevices
  ) {
    return <Forbidden />;
  }

  return <ViewSupplier supplier={supplier} />;
};

export default ViewSupplierPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers/${params.id}`,
    { headers: { Authorization: "Bearer " + token } },
  );

  if (!response.ok) throw response;

  const supplier = await response.json();
  document.title = supplier.name || "Поставщик";
  return supplier;
}

export async function action({ request, params }) {
  const { token } = getLocalStorageData();
  const data = await request.formData();

  if (data.get("intent") === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers/delete/${params.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
      },
    );

    // Удаление отклонено (за поставщиком закупки) — остаёмся на карточке,
    // объяснение показывает тост (см. ViewSupplier).
    if (response.status === 409) {
      const body = await response.json().catch(() => ({}));
      return {
        error: true,
        message:
          body.message ||
          "За поставщиком числятся закупки — удаление невозможно.",
      };
    }
    if (!response.ok) throw response;

    return redirect("/inventory/suppliers");
  }

  return null;
}
