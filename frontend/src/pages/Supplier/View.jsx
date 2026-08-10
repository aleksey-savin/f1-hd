import { redirect, useLoaderData } from "react-router";

import ViewSupplier from "../../components/Supplier/View";
import Forbidden from "../../components/Error/403";
import { useCan } from "@/store/authed-user";

const ViewSupplierPage = () => {
  const can = useCan();
  const supplier = useLoaderData();

  if (
    !can({ inventory: ["use"] }) ||
    !can({ clientDevice: ["manage"] })
  ) {
    return <Forbidden />;
  }

  return <ViewSupplier supplier={supplier} />;
};

export default ViewSupplierPage;

export async function loader({ params }) {
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers/${params.id}`,
  );

  if (!response.ok) throw response;

  const supplier = await response.json();
  document.title = supplier.name || "Поставщик";
  return supplier;
}

export async function action({ request, params }) {
  const data = await request.formData();

  if (data.get("intent") === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers/delete/${params.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
