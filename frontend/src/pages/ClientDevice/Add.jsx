import Form from "../../components/ClientDevice/Form";
import { getLocalStorageData } from "../../util/auth";

const AddClientDevicePage = () => {
  return <Form title="Новое устройство" />;
};

export default AddClientDevicePage;

export async function loader() {
  document.title = "Новое устройство";

  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const clientDevice = Object.fromEntries(data.entries());

  // Log the form data for debugging
  console.log("Form data received:", clientDevice);

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(clientDevice),
    },
  );

  if ([409, 400].includes(response.status)) {
    const errorData = await response.json();
    return {
      error: true,
      message: errorData.message,
    };
  }

  if (!response.ok) {
    throw response;
  }

  return await response.json();
}
