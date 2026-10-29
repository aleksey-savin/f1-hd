import { useEffect } from "react";
import { Link, useLocation, redirect } from "react-router";
import { isMobile } from "react-device-detect";
import { RiAddLine } from "react-icons/ri";

import ListWrapper from "@/components/app/ListWrapper";
import Segmented from "@/components/app/Segmented";
import { Button } from "@/components/ui/button";

import useDeviceTypeFilterStore, {
  kindCounts,
} from "../../store/lists/deviceTypes";
import List from "../../components/DeviceType/List";
import DeviceTypeFilter from "../../components/DeviceType/Filter";
import {
  DEFAULT_KIND,
  KIND_FORM_OPTIONS,
  KIND_OPTIONS,
  kindLabel,
} from "../../components/DeviceType/kinds";
import { invalidate } from "@/store/form-data";

// Пустой раздел словами раздела. Ничего не скрыто, кроме назначения, — типов
// такого назначения просто нет: зовём создать первый с уже выбранным
// назначением. Найденное в соседних разделах — называем их (счётчики
// сегмента говорят то же, но взгляд в этот момент на пустой панели).
// Не нашлось нигде — общее «Ничего не нашлось» ListWrapper.
const emptySegmentState = ({ kind, counts, narrowed, setKind }) => {
  const label = kindLabel(kind);
  if (!narrowed) {
    const single = KIND_FORM_OPTIONS.find((o) => o.value === kind)?.single;
    return {
      title: `В разделе «${label}» пока пусто`,
      hint: "Создайте первый тип — он появится здесь.",
      actions: (
        <Button variant="outline" asChild>
          <Link to={`/inventory/device-types/add?kind=${kind}`}>
            <RiAddLine aria-hidden />
            Новый тип — {single}
          </Link>
        </Button>
      ),
    };
  }
  const elsewhere = KIND_OPTIONS.filter(
    (option) => option.value !== kind && counts[option.value] > 0,
  );
  if (elsewhere.length === 0) return undefined;
  return {
    title: `В разделе «${label}» ничего не нашлось`,
    hint: "Есть в других разделах:",
    actions: elsewhere.map((option) => (
      <Button
        key={option.value}
        variant="outline"
        onClick={() => setKind(option.value)}
      >
        {option.label}
        <span className="font-semibold text-accent-text tabular-nums">
          {counts[option.value]}
        </span>
      </Button>
    )),
  };
};

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
    // Раздел по умолчанию бейджа не получает — он ничего не сузил
    filterStore.kind !== DEFAULT_KIND && {
      key: "kind",
      label: kindLabel(filterStore.kind),
      onRemove: () => filterStore.setKind(DEFAULT_KIND),
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

  const counts = kindCounts(filterStore);
  const narrowed =
    Boolean((filterStore.searchTerm || "").trim()) ||
    filterStore.isActive === true ||
    selectedAttributes.length > 0;

  return (
    <ListWrapper
      title={() => "Типы устройств"}
      filterStore={filterStore}
      // Новый тип из раздела — с назначением этого раздела
      addRoute={
        filterStore.kind === DEFAULT_KIND
          ? "/inventory/device-types/add"
          : `/inventory/device-types/add?kind=${filterStore.kind}`
      }
      addLabel="Новый тип"
      filter={<DeviceTypeFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
      toolbar={
        // Назначение — «что вообще считается строкой»: сегментом на виду,
        // а не полем шторки (гайд). На телефоне четыре подписи со счётчиками
        // шире экрана — ряд прокручивается жестом, без полосы.
        <div className="max-md:w-full max-md:overflow-x-auto max-md:scrollbar-none">
          <Segmented
            ariaLabel="Назначение типов"
            fit
            compact={isMobile}
            className="w-max"
            options={KIND_OPTIONS.map((option) => ({
              ...option,
              count: counts[option.value],
            }))}
            value={filterStore.kind}
            onChange={filterStore.setKind}
          />
        </div>
      }
      filteredEmptyState={emptySegmentState({
        kind: filterStore.kind,
        counts,
        narrowed,
        setKind: filterStore.setKind,
      })}
    >
      <List items={filterStore.filteredList} />
    </ListWrapper>
  );
};

export default DeviceTypeListPage;

export async function action({ request }) {
  // Справочники учёта в кэше форм устарели — следующая форма возьмёт свежие
  invalidate("/api/inventory/");
  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-types/delete/${id}`,
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

  return redirect("/inventory/device-types");
}
