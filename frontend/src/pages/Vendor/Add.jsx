import Form from "../../components/Vendor/Form";

const AddVendorPage = () => {
  return (
    <Form
      title="Новый вендор"
      // Создание → карточка созданного вендора (навигация после сабмита, гайд)
      successTo={(data) =>
        data?.vendor?._id ? `/inventory/vendors/${data.vendor._id}` : undefined
      }
    />
  );
};

export default AddVendorPage;

export async function loader() {
  document.title = "Новый вендор";
  return null;
}

export async function action({ request }) {
  const data = await request.formData();

  const vendorData = {
    name: data.get("name"),
    isActive: data.get("isActive") === "true",
    isMikrotikManagementEnabled:
      data.get("isMikrotikManagementEnabled") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors/add`,
    {
      method: "POST",
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
