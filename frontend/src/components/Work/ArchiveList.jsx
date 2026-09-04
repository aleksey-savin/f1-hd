import { useEffect } from "react";
import { useLoaderData } from "react-router";

import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import ListWrapper from "@/components/app/ListWrapper";
import MonthStepper from "@/components/app/MonthStepper";
import Pager from "@/components/app/Pager";

import useWorksStore from "../../store/lists/works";

import WorkArchiveFilter from "./ArchiveFilter";
import WorkArchiveItem from "./ArchiveItem";
import { formatDuration } from "./duration";
import { formatDayKey } from "../../util/format-date";

// Сегмент «Работы» страницы «Архив» — бывший «Отчёт по работам» на каркасе
// архива: серверная выборка по 50, открывается сразу (без обязательных
// фильтров), суммарное время ВСЕЙ выборки считает сервер (totalDurationMs) —
// строка над панелью. Сегмент-переключатель приходит из страницы (`segment`)
// и встаёт первым в toolbar — вне десктоп-обёртки чипа, он нужен и на мобайле.

// yyyy-MM-dd (значение нативного поля даты) → dd.MM.yyyy для бейджа

const WorksArchiveList = ({ segment }) => {
  const s = useWorksStore();
  const formData = useLoaderData();

  // Опции фасетов из loader страницы (form-data, включая отключённые компании)
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
          ? `Завершена: ${formatDayKey(s.from)} – ${formatDayKey(s.to)}`
          : s.from
            ? `Завершена с ${formatDayKey(s.from)}`
            : `Завершена по ${formatDayKey(s.to)}`,
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
  facetBadge("categories", "Категория", "Категории");
  facetBadge("executors", "Исполнитель", "Исполнители");

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
      filter={<WorkArchiveFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
      toolbar={toolbar}
      searchPlaceholder="Найти в работах…"
      defaultSearchValue={s.searchTerm}
      showAddButton={false}
      renderOutlet={false}
      aboveList={
        // Сводка только при заданном периоде: сумма «за всё время» бессмысленна
        // (и искажена битыми startedAt старых работ)
        s.from || s.to ? (
          <div className="mb-2 flex items-baseline justify-end gap-2 px-1">
            <span className="text-sm text-muted-foreground">
              Суммарное время выборки
            </span>
            <span className="font-semibold tabular-nums">
              {formatDuration(s.totalDurationMs)}
            </span>
          </div>
        ) : undefined
      }
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
        {s.items.map((work) => (
          <WorkArchiveItem key={work._id} work={work} />
        ))}
      </div>
    </ListWrapper>
  );
};

export default WorksArchiveList;
