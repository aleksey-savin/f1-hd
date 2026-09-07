import { useEffect } from "react";
import { redirect, useActionData, useLocation } from "react-router";

import ListWrapper from "@/components/app/ListWrapper";

import List from "../../components/Supplier/List";
import SupplierFilter from "../../components/Supplier/Filter";
import useSupplierFilterStore from "../../store/lists/suppliers";
import useToastStore from "../../store/toast-store";

// Справочник поставщиков: у кого закупаем технику. Строка отвечает на «сколько
// у него куплено и когда в последний раз» — ради этого список и открывают.
const SupplierListPage = () => {
  const location = useLocation();
  const filterStore = useSupplierFilterStore();
  const actionData = useActionData();
  const { showToast } = useToastStore();

  // Тост: удаление отклонено — за поставщиком числятся закупки (action вернул
  // { error }). Строка остаётся на месте, объяснение — в тосте.
  useEffect(() => {
    if (actionData?.error) showToast("danger", actionData.message);
  }, [actionData, showToast]);

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  // Фетчим только на самом списке: открытие шторки add/update — тоже навигация.
  // Зависимость — location.key: redirect после удаления ведёт на тот же путь.
  useEffect(() => {
    if (location.pathname === "/inventory/suppliers") {
      filterStore.fetch();
    }
  }, [location.key]);

  const activeFilters = [
    filterStore.isActive === true && {
      key: "isActive",
      label: "Только активные",
      onRemove: () => filterStore.updateFilter({ isActive: false }),
    },
  ].filter(Boolean);

  return (
    <ListWrapper
      title={() => "Поставщики"}
      filterStore={filterStore}
      addRoute="/inventory/suppliers/add"
      addLabel="Новый поставщик"
      filter={<SupplierFilter />}
      filterActive={filterStore.isActive === true}
      activeFilters={activeFilters}
    >
      <List items={filterStore.filteredList} />
    </ListWrapper>
  );
};

export default SupplierListPage;

export async function loader() {
  document.title = "Поставщики";
  return null;
}

export async function action({ request }) {
  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/suppliers/delete/${id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  // 409 — за поставщиком числятся закупки: остаёмся на списке и объясняем.
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    return {
      error: true,
      message:
        body.message ||
        "За поставщиком числятся закупки — удаление невозможно.",
    };
  }
  if (!response.ok) throw response;

  return redirect("/inventory/suppliers");
}
