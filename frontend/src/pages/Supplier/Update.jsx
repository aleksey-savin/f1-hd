import Form from "../../components/Supplier/Form";
import InlineForbidden from "../../components/Error/InlineForbidden";
import { useCan } from "@/store/authed-user";

const UpdateSupplierPage = () => {
  const can = useCan();

  if (!can({ supplier: ["manage"] })) {
    return (
      <InlineForbidden right="supplier.manage" action="изменять поставщиков" />
    );
  }

  return <Form title="Изменить поставщика" />;
};

export default UpdateSupplierPage;

export async function loader({ params }) {
  document.title = "Изменить поставщика";

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers/${params.id}`,
  );

  if (!response.ok) throw response;
  return response;
}

export async function action({ request, params }) {
  const data = await request.formData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
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
