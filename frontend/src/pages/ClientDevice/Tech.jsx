import TechEditForm from "../../components/ClientDevice/TechEditForm";
import { getLocalStorageData } from "../../util/auth";

// Сохранение идёт через тот же эндпоинт обновления устройства.
export { action } from "./Update";

const TechClientDevicePage = () => {
  return <TechEditForm title="Техническая информация" />;
};

export default TechClientDevicePage;

export async function loader({ params }) {
  document.title = "Тех. информация — устройство";

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
