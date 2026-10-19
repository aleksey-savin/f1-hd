import { useEffect } from "react";
import { Link, useLocation, redirect } from "react-router";
import { RiFolderLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import ChipSelect from "@/components/app/ChipSelect";
import ListWrapper from "@/components/app/ListWrapper";

import useDeviceAttributeFilterStore from "../../store/lists/deviceAttributes";
import useDeviceTypeFilterStore from "../../store/lists/deviceTypes";
import List from "../../components/DeviceAttribute/List";
import DeviceAttributeFilter from "../../components/DeviceAttribute/Filter";

import { valueTypeLabel } from "../../components/DeviceAttribute/value-types";
import { attributeIdsOfType } from "../../components/DeviceAttribute/device-type-links";
import { invalidate } from "@/store/form-data";
import { useCan } from "@/store/authed-user";

const DeviceAttributeListPage = () => {
  const location = useLocation();
  const filterStore = useDeviceAttributeFilterStore();
  const deviceTypeStore = useDeviceTypeFilterStore();
  const can = useCan();
  const canManage = can({ inventoryCatalog: ["manage"] });

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  // Фетчим только на самом списке: открытие/закрытие шторки add/update — тоже
  // навигация, и рефетч в этот момент дёргал бы список под шторкой (см. Vendors)
  useEffect(() => {
    if (location.pathname === "/inventory/device-attributes") {
      filterStore.fetch();
    }
  }, [location.key]);

  // Каталог типов для фасета «Тип устройства»
  useEffect(() => {
    if ((deviceTypeStore.originalList || []).length === 0) {
      deviceTypeStore.fetch();
    }
  }, []);

  const deviceTypeOptions = (deviceTypeStore.originalList || []).map(
    (deviceType) => ({
      value: deviceType._id,
      label: deviceType.name,
    }),
  );

  const selectDeviceType = (deviceTypeId) => {
    // Храним объект с готовым списком id (гайд: фасеты — объектами)
    const deviceType = deviceTypeId
      ? (deviceTypeStore.originalList || []).find(
          (item) => item._id === deviceTypeId,
        )
      : null;
    filterStore.updateFilter({
      ...filterStore,
      deviceType: deviceType
        ? {
            _id: deviceType._id,
            name: deviceType.name,
            attributeIds: attributeIdsOfType(deviceType),
          }
        : null,
    });
    filterStore.applyFilter();
  };

  const removeFilter = (patch) => {
    filterStore.updateFilter({ ...filterStore, ...patch });
    filterStore.applyFilter();
  };

  const activeFilters = [
    filterStore.isActive === true && {
      key: "isActive",
      label: "Только активные",
      onRemove: () => removeFilter({ isActive: false }),
    },
    filterStore.valueType &&
      filterStore.valueType !== "all" && {
        key: "valueType",
        label: `Тип данных: ${valueTypeLabel(filterStore.valueType)}`,
        onRemove: () => removeFilter({ valueType: "all" }),
      },
    filterStore.deviceType && {
      key: "deviceType",
      label: `Тип устройства: ${filterStore.deviceType.name}`,
      onRemove: () => removeFilter({ deviceType: null }),
    },
  ].filter(Boolean);

  return (
    <ListWrapper
      title={() => "Атрибуты устройств"}
      filterStore={filterStore}
      addRoute="/inventory/device-attributes/add"
      addLabel="Новый атрибут"
      toolbar={
        <>
          <ChipSelect
            placeholder="Тип устройства"
            allLabel="Все типы"
            value={filterStore.deviceType?._id ?? null}
            options={deviceTypeOptions}
            onChange={selectDeviceType}
          />
          {/* Справочник групп — шторка-маршрут groups над списком */}
          {canManage && (
            <Button asChild variant="outline">
              <Link to="groups">
                <RiFolderLine /> Группы
              </Link>
            </Button>
          )}
        </>
      }
      filter={<DeviceAttributeFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
    >
      <List items={filterStore.filteredList} />
    </ListWrapper>
  );
};

export default DeviceAttributeListPage;

export async function action({ request }) {
  // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
  invalidate("/api/inventory/");
  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-attributes/delete/${id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return redirect("/inventory/device-attributes");
}
