import Form from "../../components/DeviceAttribute/Form";
import { getLocalStorageData } from "../../util/auth";

const AddDeviceAttributePage = () => {
  return <Form title="Новый атрибут устройства" />;
};

export default AddDeviceAttributePage;

export async function loader() {
  document.title = "Добавить атрибут устройства";
  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const options = data.get("options");
  const optionsArray = options
    ? options
        .split("\n")
        .map((opt) => opt.trim())
        .filter(Boolean)
    : [];

  const attributeData = {
    name: data.get("name"),
    label: data.get("label"),
    description: data.get("description"),
    dataType: data.get("dataType"),
    unit: data.get("unit"),
    options: optionsArray,
    isActive: data.get("isActive") === "true",
  };

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-attributes/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
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
