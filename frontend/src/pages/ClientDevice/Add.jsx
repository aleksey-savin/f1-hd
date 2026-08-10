import Form from "../../components/ClientDevice/Form";

const AddClientDevicePage = () => {
  return <Form title="Новое устройство" />;
};

export default AddClientDevicePage;

export async function loader() {
  document.title = "Новое устройство";

  return null;
}

export async function action({ request }) {
  // Тело формы — JSON: собирать вложенные данные из FormData значит терять
  // ключи молча (см. docs/ux-ui-guide.md, «Сложное вложенное тело — JSON»).
  const clientDevice = await request.json();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/add`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
