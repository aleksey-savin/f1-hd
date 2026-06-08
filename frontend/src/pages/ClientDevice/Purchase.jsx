import PurchaseEditForm from "../../components/ClientDevice/PurchaseEditForm";
import { getLocalStorageData } from "../../util/auth";

// Сохранение идёт через тот же эндпоинт обновления устройства.
export { action } from "./Update";

const PurchaseClientDevicePage = () => {
  return <PurchaseEditForm title="Покупка устройства" />;
};

export default PurchaseClientDevicePage;

export async function loader({ params }) {
  document.title = "Покупка — устройство";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${params.id}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}
