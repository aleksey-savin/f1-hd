import DeviceAttributeForm from "../../components/DeviceAttribute/Form";

import { api } from "@/lib/api";

const UpdateDeviceAttributePage = () => {

  return <DeviceAttributeForm title="Изменить атрибут устройства" />;
};

export default UpdateDeviceAttributePage;

export async function loader({ params }) {
  document.title = "Изменить атрибут устройства";

  return api(`/api/inventory/device-attributes/${params.id}`);
}

export async function action({ request, params }) {
  const data = await request.formData();

  const options = data.get("options");
  const optionsArray = options
    ? options
        .split("\n")
        .map((opt) => opt.trim())
        .filter(Boolean)
        .map((opt) => ({
          label: opt,
          value: opt.trim().toLowerCase().replace(/\s+/g, "_"),
        }))
    : [];

  const attributeData = {
    code: data.get("code"),
    name: data.get("name"),
    valueType: data.get("valueType"),
    unit: data.get("unit"),
    options: optionsArray,
    isActive: data.get("isActive") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-attributes/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
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
