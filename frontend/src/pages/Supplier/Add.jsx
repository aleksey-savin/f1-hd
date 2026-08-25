import Form from "../../components/Supplier/Form";
import InlineForbidden from "../../components/Error/InlineForbidden";
import { useCan } from "@/store/authed-user";

const AddSupplierPage = () => {
  const can = useCan();

  if (!can({ supplier: ["manage"] })) {
    return (
      <InlineForbidden right="supplier.manage" action="заводить поставщиков" />
    );
  }

  return (
    <Form
      title="Новый поставщик"
      // Создание → карточка созданного поставщика (гайд, «Навигация после сабмита»)
      successTo={(data) =>
        data?.supplier?._id
          ? `/inventory/suppliers/${data.supplier._id}`
          : undefined
      }
    />
  );
};

export default AddSupplierPage;

export async function loader() {
  document.title = "Новый поставщик";
  return null;
}

const bodyFrom = (data) => ({
  name: data.get("name"),
  phone: data.get("phone") || "",
  email: data.get("email") || "",
  website: data.get("website") || "",
  address: data.get("address") || "",
  inn: data.get("inn") || "",
  kpp: data.get("kpp") || "",
  notes: data.get("notes") || "",
  isActive: data.get("isActive") === "true",
});

export async function action({ request }) {
  const data = await request.formData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyFrom(data)),
    },
  );

  if ([409, 422].includes(response.status)) return response;
  if (!response.ok) throw response;

  return await response.json();
}
