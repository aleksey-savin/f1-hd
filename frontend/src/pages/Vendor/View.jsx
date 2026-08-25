import { useLoaderData, redirect } from "react-router";

import ViewVendor from "../../components/Vendor/View";

const ViewVendorPage = () => {
  const { vendor, models } = useLoaderData();


  return <ViewVendor vendor={vendor} models={models} />;
};

export default ViewVendorPage;

export async function loader({ params }) {
  document.title = "Просмотр вендора";

  const headers = {};
  const base = `${import.meta.env.VITE_API_ADDRESS}/api/inventory`;

  const vendorResponse = await fetch(`${base}/vendors/${params.id}`, {
    headers,
  });
  if (!vendorResponse.ok) {
    throw vendorResponse;
  }
  const vendor = await vendorResponse.json();

  // Отдельного «модели по вендору» эндпоинта нет — берём общий список моделей
  // и фильтруем (ср. карточку типа). getAll уже populate'ит deviceTypeId/
  // vendorId и кладёт configurationsCount + photos — ровно то, что нужно
  // строкам секции «Модели устройств».
  const modelsResponse = await fetch(`${base}/device-models`, { headers });
  const allModels = modelsResponse.ok ? await modelsResponse.json() : [];
  const models = (Array.isArray(allModels) ? allModels : []).filter(
    (model) => String(model.vendorId?._id) === String(params.id),
  );

  return { vendor, models };
}

export async function action({ request }) {
  const headers = {
    "Content-Type": "application/json",
  };

  const data = await request.formData();
  if (data.get("intent") !== "delete") {
    return { ok: true };
  }
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors/delete/${id}`,
    { method: "POST", headers },
  );

  // Вендора с моделями бэкенд не даёт удалить (409) — остаёмся на карточке
  // и показываем тост (см. ViewVendor).
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    return {
      error: true,
      message:
        body.message || "Вендор используется моделями — удаление невозможно.",
    };
  }
  if (!response.ok) {
    throw response;
  }
  return redirect("/inventory/vendors");
}
