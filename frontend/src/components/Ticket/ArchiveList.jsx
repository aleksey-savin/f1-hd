import { useEffect } from "react";
import { useLoaderData, useSearchParams } from "react-router";

import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import ListWrapper from "@/components/app/ListWrapper";
import MonthStepper from "@/components/app/MonthStepper";
import Pager from "@/components/app/Pager";

import useClosedTicketsStore from "../../store/lists/closed-tickets";

import ArchiveFilter from "./ArchiveFilter";
import ArchiveItem from "./ArchiveItem";
import { formatDayKey } from "../../util/format-date";

// Сегмент «Заявки» страницы «Архив» (бывшая страница «Архив заявок» — тело
// перенесено сюда 1:1): список на серверной выборке, открывается сразу,
// «Сначала недавние» по 50 на страницу; серверный поиск по номеру/теме/
// инициатору/описанию; фильтры — Sheet + чип «Компании». Клик по строке
// открывает заявку в новой вкладке. Сегмент-переключатель приходит из страницы
// (`segment`) и встаёт первым в toolbar — вне десктоп-обёртки чипа.

// yyyy-MM-dd (значение нативного поля даты) → dd.MM.yyyy для бейджа

// Фасеты-списки, которые принимаются из адреса через запятую.
const URL_LIST_FACETS = [
  "companies",
  "applicants",
  "responsibles",
  "categories",
];

const TicketsArchiveList = ({ segment }) => {
  const s = useClosedTicketsStore();
  const formData = useLoaderData();
  const [searchParams] = useSearchParams();

  // Опции фасетов из loader (form-data, включая отключённые компании).
  // Объявлен ПЕРВЫМ намеренно: иначе бейдж пришедшего из адреса фасета не
  // найдёт, как назвать выбранное значение, и покажет «выбрано».
  useEffect(() => {
    s.setOptions(formData);
  }, [formData]);

  // Первичная загрузка. Адрес может принести готовый фильтр («Все закрытые» с
  // главной ведёт сюда с периодом и инициатором) — тогда засеиваем стор им, и
  // запрос делает сам updateFilter. Двух запросов на вход не бывает.
  useEffect(() => {
    const patch = {};
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from) patch.from = from;
    if (to) patch.to = to;
    URL_LIST_FACETS.forEach((key) => {
      const raw = searchParams.get(key);
      if (raw) patch[key] = raw.split(",").filter(Boolean);
    });
    const search = searchParams.get("search");
    if (search) patch.searchTerm = search;

    if (Object.keys(patch).length > 0) {
      s.updateFilter(patch);
    } else {
      // Без параметров прежний фильтр остаётся — он переживает уход со
      // страницы намеренно (канон «Архива»), и адрес его не сбрасывает.
      s.fetch();
    }
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
          ? `Закрыта: ${formatDayKey(s.from)} – ${formatDayKey(s.to)}`
          : s.from
            ? `Закрыта с ${formatDayKey(s.from)}`
            : `Закрыта по ${formatDayKey(s.to)}`,
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

  // Сегмент и период — и на мобайле; быстрый фасет «Компании» — только десктоп
  const toolbar = (
    <>
      {segment}
      <MonthStepper
        from={s.from}
        to={s.to}
        onChange={(range) => s.updateFilter(range)}
      />
      <span className="hidden md:contents">
        <ChipMultiCombobox
          placeholder="Компании"
          searchPlaceholder="Найти компанию…"
          countLabel={(count) => `Компании: ${count}`}
          value={s.companies}
          options={s.options.companies}
          onChange={(value) => s.updateFilter({ companies: value })}
        />
      </span>
    </>
  );

  return (
    <ListWrapper
      title={() => "Архив"}
      count={s.total}
      hasActiveQuery={hasActiveQuery}
      filterStore={s}
      filter={<ArchiveFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
      toolbar={toolbar}
      defaultSearchValue={s.searchTerm}
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

export default TicketsArchiveList;
