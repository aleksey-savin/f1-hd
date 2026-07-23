import { useEffect } from "react";
import { useLoaderData } from "react-router";

import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import ListWrapper from "@/components/app/ListWrapper";
import Pager from "@/components/app/Pager";

import useClosedTicketsStore from "../../store/lists/closed-tickets";
import { getLocalStorageData } from "../../util/auth";

import ArchiveFilter from "../../components/Ticket/ArchiveFilter";
import ArchiveItem from "../../components/Ticket/ArchiveItem";

// «Архив заявок» — список на серверной выборке: открывается сразу (без
// обязательных фильтров), «Сначала недавние» по 50 на страницу; серверный
// поиск по номеру/теме/инициатору/описанию; фильтры — Sheet + чип «Компании».
// Клик по строке открывает заявку в новой вкладке (выдача остаётся на месте).

// yyyy-MM-dd (значение нативного поля даты) → dd.MM.yyyy для бейджа
const formatBadgeDate = (isoDay) => isoDay.split("-").reverse().join(".");

const TicketsArchive = () => {
  const s = useClosedTicketsStore();
  const formData = useLoaderData();

  // Опции фасетов из loader (form-data, включая отключённые компании)
  useEffect(() => {
    s.setOptions(formData);
  }, [formData]);

  // Первичная загрузка; фильтры/сортировка/страницы делают запросы сами
  useEffect(() => {
    s.fetch();
  }, []);

  const optionLabel = (key, id) =>
    s.options[key].find((option) => option.value === id)?.label ?? "выбрано";

  // Применённые фильтры → липкий остров снимаемых бейджей
  const activeFilters = [];
  if (s.from || s.to)
    activeFilters.push({
      key: "period",
      label:
        s.from && s.to
          ? `Закрыта: ${formatBadgeDate(s.from)} – ${formatBadgeDate(s.to)}`
          : s.from
            ? `Закрыта с ${formatBadgeDate(s.from)}`
            : `Закрыта по ${formatBadgeDate(s.to)}`,
      onRemove: () => s.updateFilter({ from: "", to: "" }),
    });
  const facetBadge = (key, one, many) => {
    if (!s[key].length) return;
    activeFilters.push({
      key,
      label:
        s[key].length === 1
          ? `${one}: ${optionLabel(key, s[key][0])}`
          : `${many}: ${s[key].length}`,
      onRemove: () => s.updateFilter({ [key]: [] }),
    });
  };
  facetBadge("companies", "Компания", "Компании");
  facetBadge("applicants", "Инициатор", "Инициаторы");
  facetBadge("responsibles", "Ответственный", "Ответственные");
  facetBadge("categories", "Категория", "Категории");

  const hasActiveQuery = activeFilters.length > 0 || !!s.searchTerm;

  // Быстрый фасет «Компании» — только десктоп; на мобайле живёт в шторке
  const toolbar = (
    <span className="tw:hidden tw:md:contents">
      <ChipMultiCombobox
        placeholder="Компании"
        searchPlaceholder="Найти компанию…"
        countLabel={(count) => `Компании: ${count}`}
        value={s.companies}
        options={s.options.companies}
        onChange={(value) => s.updateFilter({ companies: value })}
      />
    </span>
  );

  return (
    <ListWrapper
      title={() => "Архив заявок"}
      count={s.total}
      hasActiveQuery={hasActiveQuery}
      filterStore={s}
      filter={<ArchiveFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
      toolbar={toolbar}
      searchPlaceholder="Найти в архиве…"
      showAddButton={false}
      renderOutlet={false}
      belowList={
        <Pager
          page={s.page}
          pageSize={s.pageSize}
          total={s.total}
          loaded={s.items.length}
          onPage={(page) => s.setPage(page)}
          onLoadMore={() => s.loadMore()}
        />
      }
    >
      <div>
        {s.items.map((ticket) => (
          <ArchiveItem key={ticket._id} ticket={ticket} />
        ))}
      </div>
    </ListWrapper>
  );
};

export default TicketsArchive;

export async function loader() {
  document.title = "Архив заявок";

  const { token } = getLocalStorageData();

  // Архив — исключение: отключённые компании и их заявители нужны в фильтрах,
  // чтобы искать по истории (обычные формы получают только активные)
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/tickets/form-data?includeInactive=true`,
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
