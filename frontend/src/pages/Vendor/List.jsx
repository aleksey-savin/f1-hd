import { useEffect } from "react";
import { useLocation, redirect } from "react-router";

import useVendorFilterStore from "../../store/lists/vendors";

import List from "../../components/Vendor/List";
import VendorFilter from "../../components/Vendor/Filter";

import ListWrapper from "@/components/app/ListWrapper";

import { getLocalStorageData } from "../../util/auth";

const VendorListPage = () => {
  const location = useLocation();
  const filterStore = useVendorFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  // Фетчим только на самом списке: открытие/закрытие шторки add/update — тоже
  // навигация, и рефетч в этот момент дёргал список под выезжающей шторкой.
  // Зависимость — location.key (меняется при КАЖДОЙ навигации): redirect после
  // удаления ведёт на тот же pathname, и по одному pathname рефетч не сработал
  // бы. Обновление фоновое (см. ListWrapper: спиннер только без данных).
  useEffect(() => {
    if (location.pathname === "/inventory/vendors") {
      filterStore.fetch();
    }
  }, [location.key]);

  const removeIsActive = () => {
    filterStore.updateFilter({ ...filterStore, isActive: false });
    filterStore.applyFilter();
  };

  const activeFilters = [
    filterStore.isActive === true && {
      key: "isActive",
      label: "Только активные",
      onRemove: removeIsActive,
    },
  ].filter(Boolean);

  return (
    <ListWrapper
      title={() => "Вендоры"}
      filterStore={filterStore}
      addRoute="/inventory/vendors/add"
      addLabel="Добавить вендора"
      filter={<VendorFilter />}
      filterActive={filterStore.isActive === true}
      activeFilters={activeFilters}
    >
      <List items={filterStore.filteredList} />
    </ListWrapper>
  );
};

export default VendorListPage;

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors/delete/${id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    },
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return redirect("/inventory/vendors");
}
