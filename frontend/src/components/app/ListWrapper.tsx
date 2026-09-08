import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

import { Link } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";
import {
  RiAddFill,
  RiArrowDownSLine,
  RiCloseLine,
  RiFilter3Line,
  RiFilterOffLine,
  RiInboxLine,
  RiRefreshLine,
} from "react-icons/ri";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FormOutlet from "@/components/app/FormOutlet";
import PageHeader from "@/components/app/PageHeader";
import SearchBar from "@/components/app/SearchBar";
import Spinner from "@/components/app/Spinner";
import { ThemeContext } from "../../store/theme-context";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";

// Каркас страниц-списков по согласованному макету: заголовок + счётчик,
// справа — поиск, сортировка (текст-дропдаун), чипы (toolbar) и «Добавить»
// (шапка — app/PageHeader, при сужении окна переносится ступенями);
// формы add/update — вложенные маршруты списка в нижней шторке, которую
// рисует app/FormOutlet: открыта она ровно тогда, когда совпал маршрут формы
// (его ширина — в handle.sheet маршрута). Контракт легаси сохранён: filterStore.
/** `shortLabel` — подпись для узкой строки инструментов (мобайл). */
type SortOption = { label: string; shortLabel?: string };

type FilterStore = {
  isLoading?: boolean;
  isSorting?: boolean;
  /** Текущий запрос поиска — стор переживает переходы, поле обязано его показывать. */
  searchTerm?: string;
  fullTextSearch: (query: string) => void;
  sortBy?: SortOption;
  sortingOptions?: SortOption[];
  handleSorting: (selected: SortOption) => void;
  filteredList?: unknown[];
  originalList?: unknown[];
  resetFilter?: () => void;
};

// Пустое состояние панели (по гайду — не пустота, а объяснение + действие)
const EmptyState = ({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof RiInboxLine;
  title: ReactNode;
  hint: ReactNode;
  children?: ReactNode;
}) => (
  <div className="flex flex-col items-center gap-1.5 px-6 py-16 text-center">
    <Icon size={44} aria-hidden className="mb-1 text-faint" />
    <div className="text-lg font-semibold">{title}</div>
    <p className="my-0 max-w-md text-base text-muted-foreground">{hint}</p>
    {children && (
      <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>
    )}
  </div>
);

type ActiveFilter = {
  key: string;
  label: ReactNode;
  onRemove: () => void;
};

type ListWrapperProps = {
  title: () => ReactNode;
  filter?: ReactNode;
  customData?: () => ReactNode;
  topContent?: ReactNode;
  /** Чипы/контролы в строке инструментов (например, FilterChip). */
  toolbar?: ReactNode;
  /** Применённые фильтры — липкая полоса бейджей над списком (видна при
   *  скролле; каждый бейдж снимается крестиком). */
  activeFilters?: ActiveFilter[];
  /** Шапка режима выбора (app/SelectionBar) — липкая строка, приросшая к верху
   *  панели списка. Пока она есть, липкость у плашки activeFilters снимается:
   *  на экране один закреплённый объект, а фильтры во время выбора не меняют. */
  selection?: ReactNode;
  /** Серверный счётчик (total) — переопределяет число у заголовка. Включает
   *  серверный режим пустых состояний (см. hasActiveQuery). */
  count?: number;
  /** Узел под списком (напр. пагинатор) — рендерится, когда есть данные. */
  belowList?: ReactNode;
  /** Узел между плашкой фильтров и панелью списка (сводка серверной выборки —
   *  «Суммарное время» сегмента «Работы» архива) — рендерится, когда есть
   *  данные. */
  aboveList?: ReactNode;
  /** Серверный режим: активны ли поиск/фильтры. При count===0 решает, что
   *  показать — «ничего не нашлось» (есть запрос) или «список пуст». */
  hasActiveQuery?: boolean;
  filterStore: FilterStore;
  filterActive?: boolean;
  addRoute?: string;
  addLabel?: string;
  onAddClick?: () => void;
  hiddenAddButton?: boolean;
  showAddButton?: boolean;
  showRefreshButton?: boolean;
  defaultSearchValue?: string;
  /** Плейсхолдер поиска — переопределяет дефолтный «Поиск…» из SearchBar. */
  searchPlaceholder?: string;
  showSortAndCount?: boolean;
  /** Пустое состояние «данных нет вовсе». Умолчание — «Список пуст», но у
   *  очереди задач пустота не недоделка, а хорошая новость («Открытых заявок
   *  нет»), и об этом стоит сказать словами раздела. */
  emptyTitle?: ReactNode;
  emptyHint?: ReactNode;
  /** Дополнительное действие рядом с кнопкой создания в пустом состоянии. */
  emptyAction?: ReactNode;
  renderOutlet?: boolean;
  children?: ReactNode;
};

const ListWrapper = ({
  title,
  filter,
  customData,
  topContent,
  toolbar,
  activeFilters = [],
  selection,
  count,
  belowList,
  aboveList,
  hasActiveQuery = false,
  filterStore,
  filterActive = false,
  addRoute,
  addLabel = "Добавить",
  onAddClick,
  hiddenAddButton,
  showAddButton = true,
  showRefreshButton = false,
  defaultSearchValue = "",
  searchPlaceholder,
  showSortAndCount = true,
  emptyTitle,
  emptyHint,
  emptyAction,
  // Шторка с формами add/update (app/FormOutlet). Экраны, рендерящие
  // <Outlet/> сами (база знаний), передают false — иначе маршрут
  // смонтируется дважды.
  renderOutlet = true,
  children,
}: ListWrapperProps) => {
  const filterOffcanvas = useMobileFilterOffcanvasStore();
  // Инкремент ремоунтит неконтролируемый SearchBar — очистка инпута при
  // «Сбросить фильтры» (resetFilter стора сбрасывает только searchTerm)
  const [searchResetKey, setSearchResetKey] = useState(0);

  const isLoading = filterStore.isLoading || filterStore.isSorting;
  const serverMode = typeof count === "number";
  const filteredCount = Number(filterStore.filteredList?.length) || 0;
  const originalCount = Number(filterStore.originalList?.length) || 0;
  // Серверный режим: пустоту решает total (count) + признак активного запроса;
  // легаси-режим — длины списков.
  const noData = serverMode
    ? count === 0 && !hasActiveQuery
    : originalCount === 0 && filteredCount === 0;
  // Данные есть, но запрос/фильтры скрыли всё
  const filteredEmpty = serverMode
    ? count === 0 && hasActiveQuery
    : !noData && filteredCount === 0;

  const searchHandler = (e: ChangeEvent<HTMLInputElement>) => {
    filterStore.fullTextSearch(e.target.value);
  };

  // Стор фильтров переживает переходы: после возврата список уже отфильтрован
  // по прежнему запросу, и пустое поле молчало бы о том, чем. Поэтому поле
  // стартует с запроса стора, если страница не передала своего.
  const initialSearch = defaultSearchValue || filterStore.searchTerm || "";

  const resetFiltersHandler = () => {
    filterStore.resetFilter?.();
    setSearchResetKey((key) => key + 1);
  };

  // Поисковый запрос — такой же применённый фильтр, как чипы страницы: без
  // него плашка не показывалась, и список, отфильтрованный одним поиском,
  // было нечем сбросить, кроме как стереть поле руками. Снятие чипа чистит
  // запрос в сторе и перемонтирует поле пустым (оно неуправляемое).
  const clearSearch = () => {
    filterStore.fullTextSearch("");
    setSearchResetKey((key) => key + 1);
  };
  const searchTerm = (filterStore.searchTerm || "").trim();
  const appliedFilters: ActiveFilter[] = [
    ...(searchTerm
      ? [
          {
            key: "__search",
            label: `Поиск: «${searchTerm}»`,
            onRemove: clearSearch,
          },
        ]
      : []),
    ...activeFilters,
  ];

  // Прилипание плашки фильтров: sentinel над ней уходит за порог (высота
  // навбара; на мобайле раньше срабатывает клип скролл-контейнера) —
  // у плашки снимается верхнее скругление, она «прирастает» к бару
  const hasActiveFilters = appliedFilters.length > 0;
  const stuckSentinelRef = useRef<HTMLDivElement | null>(null);
  const [filtersStuck, setFiltersStuck] = useState(false);
  // theme-context — ещё .jsx, типизируем на границе
  const { fontScale } = useContext(ThemeContext) as { fontScale: number };

  useEffect(() => {
    if (!hasActiveFilters) {
      setFiltersStuck(false);
      return;
    }
    const sentinel = stuckSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") {
      return;
    }
    // Порог — высота навбара (h-14 = 3.5rem) плюс его граница. rootMargin
    // понимает только px и %, поэтому rem считаем сами и пересобираем
    // наблюдателя при смене личного масштаба текста.
    const remPx =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const observer = new IntersectionObserver(
      ([entry]) => setFiltersStuck(!entry.isIntersecting),
      { rootMargin: `-${Math.round(3.5 * remPx + 1)}px 0px 0px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasActiveFilters, fontScale]);

  const headerCount = serverMode
    ? count
    : filterStore.filteredList?.length || 0;

  const titleBlock = (
    // items-baseline: при разных кеглях заголовка и счётчика центрирование
    // по середине строки выглядит «съехавшим» — равняем по базовой линии
    <div className="flex items-baseline gap-2">
      <h1 className="my-0 flex items-center gap-2 text-3xl leading-none font-semibold tracking-tight">
        {title()}
      </h1>
      {showSortAndCount && (
        <span className="text-xl leading-none font-medium text-faint tabular-nums">
          {headerCount}
        </span>
      )}
    </div>
  );

  const sortDropdown = showSortAndCount && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Короткая подпись (`shortLabel` у опции) — для узкой строки
            инструментов: «Сначала новые» вытесняет из ряда сегмент набора */}
        <Button variant="ghost" className="font-medium">
          <span className="hidden sm:inline">
            {filterStore.sortBy?.label ?? "Сортировка"}
          </span>
          <span className="sm:hidden">
            {filterStore.sortBy?.shortLabel ??
              filterStore.sortBy?.label ??
              "Сортировка"}
          </span>
          <RiArrowDownSLine aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={filterStore.sortBy?.label}
          onValueChange={(label) => {
            const option = filterStore.sortingOptions?.find(
              (o) => o.label === label,
            );
            if (option) filterStore.handleSorting(option);
          }}
        >
          {(filterStore.sortingOptions ?? []).map((option) => (
            <DropdownMenuRadioItem key={option.label} value={option.label}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const refreshButton = showRefreshButton && (
    <Button
      asChild
      variant="ghost"
      size="icon"
      title="Обновить"
      aria-label="Обновить список"
    >
      <Link replace to=".">
        <RiRefreshLine />
      </Link>
    </Button>
  );

  const addButton = (iconOnly: boolean) =>
    showAddButton &&
    !hiddenAddButton &&
    (onAddClick ? (
      <Button
        onClick={onAddClick}
        size={iconOnly ? "icon" : "default"}
        title={addLabel}
        aria-label={addLabel}
      >
        <RiAddFill />
        {!iconOnly && addLabel}
      </Button>
    ) : (
      <Button
        asChild
        size={iconOnly ? "icon" : "default"}
        title={addLabel}
        aria-label={addLabel}
      >
        <Link to={addRoute || "add"}>
          <RiAddFill />
          {!iconOnly && addLabel}
        </Link>
      </Button>
    ));

  const filterButton = filter && (
    <Button
      variant={filterActive ? "success" : "outline"}
      size="icon"
      onClick={filterOffcanvas.handleShow}
      title="Фильтр"
      aria-label="Фильтр"
    >
      <RiFilter3Line />
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-7xl">
      <BrowserView>
        {/* Ширину поиска задаёт шапка (20rem, на узкой ступени — вся строка) */}
        <PageHeader
          className="mb-4"
          title={titleBlock}
          search={
            <SearchBar
              key={searchResetKey}
              onChange={searchHandler}
              defaultValue={initialSearch}
              placeholder={searchPlaceholder}
            />
          }
          sort={sortDropdown}
          controls={
            <>
              {refreshButton}
              {toolbar}
              {filterButton}
            </>
          }
          action={addButton(false)}
        />
      </BrowserView>
      <MobileView>
        <div className="mb-3 flex items-center gap-2">
          {titleBlock}
          <div className="ms-auto">{addButton(true)}</div>
        </div>
        <div className="mb-3">
          <SearchBar
            key={searchResetKey}
            onChange={searchHandler}
            defaultValue={initialSearch}
            placeholder={searchPlaceholder}
            size="lg"
          />
        </div>
        {(toolbar || filter || showSortAndCount) && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {toolbar}
            {filterButton}
            <div className="ms-auto">{sortDropdown}</div>
          </div>
        )}
      </MobileView>
      {/* Sheet фильтра — общий: кнопка «Фильтр» есть и на десктопе
          (узкая панель слева), и на мобайле */}
      {filter && (
        <Sheet
          open={filterOffcanvas.isActive}
          onOpenChange={(open) => {
            if (!open) filterOffcanvas.handleClose();
          }}
        >
          <SheetContent side="left" className="w-5/6 max-w-sm">
            <SheetHeader className="border-b border-border">
              <SheetTitle>Фильтр</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {filter}
            </div>
          </SheetContent>
        </Sheet>
      )}
      {topContent}
      {customData ? customData() : ""}
      {/* Применённые фильтры: липкий «остров» — виден и при проскроленном в
          конец списке; бейдж снимается крестиком, «Сбросить» убирает всё */}
      {hasActiveFilters && (
        // Sentinel — в потоке ПЕРЕД sticky-обёрткой: его уход за порог и
        // означает «плашка прилипла»
        <div aria-hidden ref={stuckSentinelRef} className="h-px -mb-px" />
      )}
      {hasActiveFilters && (
        // top-14 = высота навбара: при скролле плашка приклеивается к нему
        // вплотную (на мобайле бар в потоке шелла — липнем к верху скролла).
        // В режиме выбора липкость уходит шапке выбора — двух приклеенных
        // плашек друг на друге не бывает.
        <div
          className={cn(
            "z-30 mb-3",
            selection ? "relative" : "sticky top-14 max-md:top-0",
          )}
        >
          <div
            className={cn(
              "flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card/85 px-2.5 py-1.5 backdrop-blur-md",
              "transition-[border-radius,border-color] duration-200",
              !selection &&
                filtersStuck &&
                "rounded-t-none border-t-transparent",
            )}
          >
            <RiFilter3Line
              size={15}
              aria-hidden
              className="ms-1 flex-none text-accent-text"
            />
            {appliedFilters.map((appliedFilter) => (
              <button
                key={appliedFilter.key}
                type="button"
                onClick={appliedFilter.onRemove}
                title="Снять фильтр"
                className="inline-flex cursor-pointer appearance-none items-center gap-1 rounded-full border-0 bg-primary/15 px-2.5 py-1 text-sm font-medium text-accent-text outline-none hover:bg-primary/25 focus-visible:ring-4 focus-visible:ring-ring/50"
              >
                {appliedFilter.label}
                <RiCloseLine size={14} aria-hidden />
              </button>
            ))}
            <Button
              variant="ghost"
              size="xs"
              className="ms-auto"
              onClick={resetFiltersHandler}
            >
              Сбросить
            </Button>
          </div>
        </div>
      )}
      {/* Пока данные есть — список стоит на месте: фоновый рефетч и навигация
          в шторку НЕ подменяют его спиннером. Никаких глобальных fade-обёрток —
          движение точечное, на уровне строк (row-appear / row-flash в
          ListRow). Спиннер — только у первой загрузки, когда показывать нечего.
          Пустые состояния предлагают действие (гайд): сброс/открытие фильтра
          при отфильтрованном в ноль списке, «Добавить …» при пустых данных. */}
      {!noData && !filteredEmpty && aboveList}
      {/* Шапка режима выбора прирастает к верху панели: её нижняя граница и
          служит разделителем. Внутрь панели её положить нельзя — там
          overflow-hidden (клип ховера по скруглению), а он ломает sticky. */}
      {!noData && !filteredEmpty && selection && (
        <div className="sticky top-14 z-30 max-md:top-0">
          <div className="rounded-t-xl border border-border bg-card">
            {selection}
          </div>
        </div>
      )}
      {!noData && (
        <div
          className={cn(
            "overflow-hidden border border-border bg-card pb-1.5",
            selection && !filteredEmpty
              ? "rounded-b-xl border-t-0"
              : "rounded-xl",
          )}
        >
          {filteredEmpty ? (
            <EmptyState
              icon={RiFilterOffLine}
              title="Ничего не нашлось"
              hint="Измените запрос или сбросьте фильтры."
            >
              <Button variant="outline" onClick={resetFiltersHandler}>
                Сбросить фильтры
              </Button>
              {filter && (
                <Button variant="ghost" onClick={filterOffcanvas.handleShow}>
                  Открыть фильтр
                </Button>
              )}
            </EmptyState>
          ) : (
            children
          )}
        </div>
      )}
      {!noData && !filteredEmpty && belowList}
      {noData && isLoading && <Spinner />}
      {noData && !isLoading && (
        <div className="overflow-hidden rounded-xl border border-border bg-card pb-1.5">
          <EmptyState
            icon={RiInboxLine}
            title={emptyTitle ?? "Список пуст"}
            hint={
              emptyHint ??
              (showAddButton && !hiddenAddButton && (addRoute || onAddClick)
                ? "Добавьте первую запись — она появится здесь."
                : "Здесь пока ничего нет.")
            }
          >
            {addButton(false)}
            {emptyAction}
          </EmptyState>
        </div>
      )}
      {renderOutlet && <FormOutlet />}
    </div>
  );
};

export default ListWrapper;
