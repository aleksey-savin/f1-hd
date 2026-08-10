import Form from "../../components/ClientDevice/Form";

import { api } from "@/lib/api";

const UpdateClientDevicePage = () => {
  return <Form title="Изменить устройство" />;
};

export default UpdateClientDevicePage;

export async function loader({ params }) {
  document.title = "Изменить устройство";

  return api(`/api/inventory/client-devices/${params.id}`);
}

export async function action({ request, params }) {
  // Тело формы — JSON (см. docs/ux-ui-guide.md, «Сложное вложенное тело»).
  const clientDeviceData = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/update/${params.id}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(clientDeviceData),
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
