import VendorForm from "../../components/Vendor/Form";

import { api } from "@/lib/api";

const UpdateVendorPage = () => {

  return <VendorForm title="Изменить вендора" />;
};

export default UpdateVendorPage;

export async function loader({ params }) {
  document.title = "Изменить вендора";

  return api(`/api/inventory/vendors/${params.id}`);
}

export async function action({ request, params }) {
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
