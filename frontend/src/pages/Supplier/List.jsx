import { useEffect, useMemo } from "react";
import { redirect, useActionData, useLocation } from "react-router";

import ChipCombobox from "@/components/app/ChipCombobox";
import ChipSelect from "@/components/app/ChipSelect";
import ListWrapper from "@/components/app/ListWrapper";

import List from "../../components/Supplier/List";
import SupplierFilter from "../../components/Supplier/Filter";
import useSupplierFilterStore, {
  currentYear,
} from "../../store/lists/suppliers";
import { companyOptions, yearOptions } from "../../store/lists/supplier-scope";
import useToastStore from "../../store/toast-store";

// Справочник поставщиков: у кого закупаем технику. Строка отвечает на «сколько
// у него куплено в выбранном году и когда в последний раз» — ради этого список
// и открывают. Год и компания — чипы панели: подрядчики приходят и уходят, и
// накопленный с основания итог о сегодняшней работе не говорит ничего.
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

  // Опции чипов — из самих закупок: в списке компаний только те, для кого
  // действительно покупали, в списке лет — годы, в которые были поставки.
  const companies = useMemo(
    () => companyOptions(filterStore.originalList),
    [filterStore.originalList],
  );
  const years = useMemo(
    () => yearOptions(filterStore.originalList, currentYear()),
    [filterStore.originalList],
  );

  // Чипы панели в плашке снимаемых бейджей не дублируются — только фасеты
  // шторки.
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
      toolbar={
        <>
          {companies.length > 0 && (
            <ChipCombobox
              placeholder="Компания"
              allLabel="Все компании"
              searchPlaceholder="Найти компанию…"
              value={filterStore.companyId}
              options={companies}
              onChange={(companyId) => filterStore.updateFilter({ companyId })}
            />
          )}
          <ChipSelect
            placeholder="За всё время"
            allLabel="За всё время"
            value={filterStore.year === null ? null : String(filterStore.year)}
            options={years}
            onChange={(year) =>
              filterStore.updateFilter({ year: year ? Number(year) : null })
            }
          />
        </>
      }
      filter={<SupplierFilter />}
      filterActive={filterStore.isActive === true}
      activeFilters={activeFilters}
    >
      <List items={filterStore.filteredList} year={filterStore.year} />
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
