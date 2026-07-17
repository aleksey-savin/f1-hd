import { useEffect } from "react";
import { useLocation, redirect } from "react-router";

import ChipSelect from "@/components/app/ChipSelect";
import ListWrapper from "@/components/app/ListWrapper";

import useDeviceModelFilterStore from "../../store/lists/deviceModels";
import List from "../../components/DeviceModel/List";
import DeviceModelFilter from "../../components/DeviceModel/Filter";

import { getLocalStorageData } from "../../util/auth";

const DeviceModelListPage = () => {
  const location = useLocation();
  const filterStore = useDeviceModelFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  // Фетчим только на самом списке: открытие/закрытие шторки add/update — тоже
  // навигация, и рефетч в этот момент дёргал бы список под шторкой
  useEffect(() => {
    if (location.pathname === "/inventory/device-models") {
      filterStore.fetch();
    }
  }, [location.key]);

  // Быстрый фасет «Тип устройства» в панели инструментов (ChipSelect). Опции —
  // из самого каталога (типы, у которых есть модели); тот же facet, что и в
  // Sheet-фильтре, поэтому чип и Sheet синхронны.
  const deviceTypeOptions = [
    ...new Map(
      (filterStore.originalList || [])
        .map((model) => model.deviceTypeId)
        .filter(Boolean)
        .map((type) => [String(type._id), { value: type._id, label: type.name }]),
    ).values(),
  ].sort((a, b) => (a.label || "").localeCompare(b.label || ""));

  const selectDeviceType = (deviceTypeId) => {
    const type = deviceTypeId
      ? (filterStore.originalList || [])
          .map((model) => model.deviceTypeId)
          .find((item) => item && String(item._id) === String(deviceTypeId))
      : null;
    filterStore.updateFilter({
      ...filterStore,
      deviceType: type ? { _id: type._id, name: type.name } : null,
    });
    filterStore.applyFilter();
  };

  const removeFilter = (patch) => {
    filterStore.updateFilter({ ...filterStore, ...patch });
    filterStore.applyFilter();
  };

  const activeFilters = [
    filterStore.deviceType && {
      key: "deviceType",
      label: `Тип: ${filterStore.deviceType.name}`,
      onRemove: () => removeFilter({ deviceType: null }),
    },
    filterStore.vendor && {
      key: "vendor",
      label: `Производитель: ${filterStore.vendor.name}`,
      onRemove: () => removeFilter({ vendor: null }),
    },
  ].filter(Boolean);

  return (
    <ListWrapper
      title={() => "Модели устройств"}
      filterStore={filterStore}
      addRoute="/inventory/device-models/add"
      addLabel="Добавить модель"
      toolbar={
        <ChipSelect
          placeholder="Тип устройства"
          allLabel="Все типы"
          value={filterStore.deviceType?._id ?? null}
          options={deviceTypeOptions}
          onChange={selectDeviceType}
        />
      }
      filter={<DeviceModelFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
    >
      <List items={filterStore.filteredList} />
    </ListWrapper>
  );
};

export default DeviceModelListPage;

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/delete/${id}`,
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

  return redirect("/inventory/device-models");
}
