import { useEffect } from "react";
import { useLocation, redirect } from "react-router";

import ListWrapper from "@/components/app/ListWrapper";

import useDeviceTypeFilterStore from "../../store/lists/deviceTypes";
import List from "../../components/DeviceType/List";
import DeviceTypeFilter from "../../components/DeviceType/Filter";
import { kindLabel } from "../../components/DeviceType/kinds";

import { getLocalStorageData } from "../../util/auth";

const DeviceTypeListPage = () => {
  const location = useLocation();
  const filterStore = useDeviceTypeFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  // Фетчим только на самом списке: открытие/закрытие шторки add/update — тоже
  // навигация, и рефетч в этот момент дёргал бы список под шторкой (см. Vendors)
  useEffect(() => {
    if (location.pathname === "/inventory/device-types") {
      filterStore.fetch();
    }
  }, [location.key]);

  const removeFilter = (patch) => {
    filterStore.updateFilter({ ...filterStore, ...patch });
    filterStore.applyFilter();
  };

  const selectedAttributes = filterStore.attributes || [];
  const activeFilters = [
    filterStore.isActive === true && {
      key: "isActive",
      label: "Только активные",
      onRemove: () => removeFilter({ isActive: false }),
    },
    filterStore.kind && {
      key: "kind",
      label: kindLabel(filterStore.kind),
      onRemove: () => removeFilter({ kind: null }),
    },
    ...selectedAttributes.map((attribute) => ({
      key: `attribute-${attribute._id}`,
      label: `Атрибут: ${attribute.name}`,
      onRemove: () =>
        removeFilter({
          attributes: selectedAttributes.filter(
            (selected) => selected._id !== attribute._id,
          ),
        }),
    })),
  ].filter(Boolean);

  return (
    <ListWrapper
      title={() => "Типы устройств"}
      filterStore={filterStore}
      addRoute="/inventory/device-types/add"
      addLabel="Добавить тип"
      filter={<DeviceTypeFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
    >
      <List items={filterStore.filteredList} />
    </ListWrapper>
  );
};

export default DeviceTypeListPage;

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/delete/${id}`,
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

  return redirect("/inventory/device-types");
}
