import { useLoaderData, redirect } from "react-router";

import ViewLocation from "../../components/Location/View";
import { getLocalStorageData } from "../../util/auth";

// Гейта Forbidden нет намеренно: getOne на бэкенде доступен любому
// авторизованному (как список расположений); кнопки управления карточка
// показывает по canManageClientDevices.
const ViewLocationPage = () => {
  const { location, ancestors, children, devices } = useLoaderData();

  return (
    <ViewLocation
      location={location}
      ancestors={ancestors}
      childLocations={children}
      devices={devices}
    />
  );
};

export default ViewLocationPage;

export async function loader({ params }) {
  document.title = "Просмотр расположения";

  const { token } = getLocalStorageData();

  // getOne отдаёт всё для карточки разом: location + ancestors (крошки) +
  // children с числом устройств + устройства «здесь» (тонкие DTO).
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations/${params.id}`,
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!response.ok) {
    throw response;
  }
  return await response.json();
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  if (data.get("intent") !== "delete") {
    return { ok: true };
  }
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations/delete/${id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    },
  );

  // Расположение с устройствами или вложенными бэкенд не удаляет (400) —
  // остаёмся на карточке и показываем тост (см. ViewLocation).
  if ([400, 409].includes(response.status)) {
    const body = await response.json().catch(() => ({}));
    return {
      error: true,
      message: body.message || "Не удалось удалить расположение.",
    };
  }
  if (!response.ok) {
    throw response;
  }
  return redirect("/inventory/locations");
}
