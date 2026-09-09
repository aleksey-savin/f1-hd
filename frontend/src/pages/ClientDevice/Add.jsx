import { load } from "@/store/form-data";
import Form from "../../components/ClientDevice/Form";

const AddClientDevicePage = () => {
  return <Form title="Новое устройство" />;
};

export default AddClientDevicePage;

// Справочники — из кэша (store/form-data): их пять, и форма ждала их сама,
// показывая спиннер в уже открытой шторке. Шторка обязана открываться по
// готовности, а ожидание — жить на линии под баром оболочки.
export async function loader() {
  document.title = "Новое устройство";

  return { device: null, formData: await loadFormData() };
}

// Каждая ручка отдаёт массив, но форма и раньше страховалась: пришедший не
// массив обнуляет ровно свой селект, а не роняет всю форму.
const asList = (value) => (Array.isArray(value) ? value : []);

export async function loadFormData() {
  const [companies, deviceTypes, vendors, deviceModels, suppliers] =
    await Promise.all([
      load("/api/companies"),
      load("/api/inventory/device-types"),
      load("/api/inventory/vendors"),
      load("/api/inventory/device-models"),
      load("/api/inventory/suppliers"),
    ]);
  return {
    companies: asList(companies),
    deviceTypes: asList(deviceTypes),
    vendors: asList(vendors),
    deviceModels: asList(deviceModels),
    suppliers: asList(suppliers),
  };
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
