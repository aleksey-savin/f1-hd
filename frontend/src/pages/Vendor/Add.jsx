import Form from "../../components/Vendor/Form";
import { getLocalStorageData } from "../../util/auth";

const AddVendorPage = () => {
  return <Form title="Новый вендор" />;
};

export default AddVendorPage;

export async function loader() {
  document.title = "Добавить вендор";
  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const vendorData = {
    name: data.get("name"),
    isActive: data.get("isActive") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors/add`,
    {
      method: "POST",
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
