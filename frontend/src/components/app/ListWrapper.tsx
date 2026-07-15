import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

import { Link, Outlet, useNavigate } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";
import {
  RiAddFill,
  RiArrowDownSLine,
  RiArrowGoBackLine,
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
import FormSheet from "@/components/app/FormSheet";
import { InsideOverlayContext } from "@/components/app/overlay-context";
import SearchBar from "@/components/app/SearchBar";
import Spinner from "@/components/app/Spinner";
import useOffcanvasStore from "@/store/offcanvas";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";

// Каркас страниц-списков по согласованному макету: заголовок + счётчик,
// справа — поиск, сортировка (текст-дропдаун), чипы (toolbar) и «Добавить»;
// формы add/update — в нижней шторке (десктоп: колонка 600px по центру,
// мобайл: почти весь экран). Контракты легаси сохранены: filterStore,
// store/offcanvas.js (Root.jsx открывает шторку по хвосту пути add/update).
type SortOption = { label: string };

type FilterStore = {
  isLoading?: boolean;
  isSorting?: boolean;
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
  <div className="tw:flex tw:flex-col tw:items-center tw:gap-1.5 tw:px-6 tw:py-16 tw:text-center">
    <Icon size={44} aria-hidden className="tw:mb-1 tw:text-faint" />
    <div className="tw:text-lg tw:font-semibold">{title}</div>
    <p className="tw:my-0 tw:max-w-md tw:text-base tw:text-muted-foreground">
      {hint}
    </p>
    {children && (
      <div className="tw:mt-3 tw:flex tw:flex-wrap tw:justify-center tw:gap-2">
        {children}
      </div>
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
  filterStore: FilterStore;
  filterActive?: boolean;
  addRoute?: string;
  addLabel?: string;
  onAddClick?: () => void;
  hiddenAddButton?: boolean;
  showAddButton?: boolean;
  showBackButton?: boolean;
  showRefreshButton?: boolean;
  backRoute?: string;
  defaultSearchValue?: string;
  showSortAndCount?: boolean;
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
  filterStore,
  filterActive = false,
  addRoute,
  addLabel = "Добавить",
  onAddClick,
  hiddenAddButton,
  showAddButton = true,
  showBackButton = false,
  showRefreshButton = false,
  backRoute,
  defaultSearchValue = "",
  showSortAndCount = true,
  // Нижняя шторка с <Outlet/> для форм add/update. Экраны, рендерящие
  // <Outlet/> сами (база знаний), передают false — иначе маршрут
  // смонтируется дважды.
  renderOutlet = true,
  children,
}: ListWrapperProps) => {
  const navigate = useNavigate();

  const filterOffcanvas = useMobileFilterOffcanvasStore();
  const offcanvas = useOffcanvasStore();
  // Инкремент ремоунтит неконтролируемый SearchBar — очистка инпута при
  // «Сбросить фильтры» (resetFilter стора сбрасывает только searchTerm)
  const [searchResetKey, setSearchResetKey] = useState(0);

  const isLoading = filterStore.isLoading || filterStore.isSorting;
  const filteredCount = Number(filterStore.filteredList?.length) || 0;
  const originalCount = Number(filterStore.originalList?.length) || 0;
  const noData = originalCount === 0 && filteredCount === 0;
  // Данные есть, но запрос/фильтры скрыли всё
  const filteredEmpty = !noData && filteredCount === 0;

  const searchHandler = (e: ChangeEvent<HTMLInputElement>) => {
    filterStore.fullTextSearch(e.target.value);
  };

  const resetFiltersHandler = () => {
    filterStore.resetFilter?.();
    setSearchResetKey((key) => key + 1);
  };

  // Прилипание плашки фильтров: sentinel над ней уходит за порог (высота
  // навбара; на мобайле раньше срабатывает клип скролл-контейнера) —
  // у плашки снимается верхнее скругление, она «прирастает» к бару
  const hasActiveFilters = activeFilters.length > 0;
  const stuckSentinelRef = useRef<HTMLDivElement | null>(null);
  const [filtersStuck, setFiltersStuck] = useState(false);

  useEffect(() => {
    if (!hasActiveFilters) {
      setFiltersStuck(false);
      return;
    }
    const sentinel = stuckSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setFiltersStuck(!entry.isIntersecting),
      { rootMargin: "-57px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasActiveFilters]);

  const count = filterStore.filteredList?.length || 0;

  const titleBlock = (
    // items-baseline: при разных кеглях заголовка и счётчика центрирование
    // по середине строки выглядит «съехавшим» — равняем по базовой линии
    <div className="tw:flex tw:items-baseline tw:gap-2">
      <h1 className="tw:my-0 tw:flex tw:items-center tw:gap-2 tw:text-4xl tw:leading-none tw:font-semibold tw:tracking-tight">
        {title()}
      </h1>
      {showSortAndCount && (
        <span className="tw:text-2xl tw:leading-none tw:font-medium tw:text-faint tw:tabular-nums">
          {count}
        </span>
      )}
    </div>
  );

  const sortDropdown = showSortAndCount && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="tw:font-medium">
          {filterStore.sortBy?.label ?? "Сортировка"}
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

  const backButton =
    showBackButton &&
    (backRoute ? (
      <Button asChild variant="ghost" size="icon" title="Назад" aria-label="Назад">
        <Link to={backRoute}>
          <RiArrowGoBackLine />
        </Link>
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="icon"
        title="Назад"
        aria-label="Назад"
        onClick={() => navigate(-1)}
      >
        <RiArrowGoBackLine />
      </Button>
    ));

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
        <Link to={addRoute || "add"} onClick={offcanvas.setShow}>
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
    <div className="tw:mx-auto tw:w-full tw:max-w-7xl">
      <BrowserView>
        <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-3">
          {backButton}
          {titleBlock}
          <div className="tw:ms-auto tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
            {refreshButton}
            <SearchBar
              key={searchResetKey}
              onChange={searchHandler}
              defaultValue={defaultSearchValue}
              className="tw:w-80"
            />
            {sortDropdown}
            {toolbar}
            {filterButton}
            {addButton(false)}
          </div>
        </div>
      </BrowserView>
      <MobileView>
        <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2">
          {backButton}
          {titleBlock}
          <div className="tw:ms-auto">{addButton(true)}</div>
        </div>
        <div className="tw:mb-3">
          <SearchBar
            key={searchResetKey}
            onChange={searchHandler}
            defaultValue={defaultSearchValue}
            size="lg"
          />
        </div>
        {(toolbar || filter || showSortAndCount) && (
          <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2">
            {toolbar}
            {filterButton}
            <div className="tw:ms-auto">{sortDropdown}</div>
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
          <SheetContent side="left" className="tw:w-5/6 tw:max-w-sm">
            <SheetHeader className="tw:border-b tw:border-border">
              <SheetTitle className="tw:text-base">Фильтр</SheetTitle>
            </SheetHeader>
            <div className="tw:flex-1 tw:overflow-y-auto tw:px-4 tw:pb-4">
              {/* UI/Select внутри шторки переключается на инлайн-меню */}
              <InsideOverlayContext.Provider value={true}>
                {filter}
              </InsideOverlayContext.Provider>
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
        <div aria-hidden ref={stuckSentinelRef} className="tw:h-px tw:-mb-px" />
      )}
      {hasActiveFilters && (
        // top-14 = высота навбара: при скролле плашка приклеивается к нему
        // вплотную (на мобайле бар в потоке шелла — липнем к верху скролла)
        <div className="tw:sticky tw:top-14 tw:z-30 tw:mb-3 tw:max-md:top-0">
          <div
            className={cn(
              "tw:flex tw:flex-wrap tw:items-center tw:gap-1.5 tw:rounded-xl tw:border tw:border-border tw:bg-card/85 tw:px-2.5 tw:py-1.5 tw:backdrop-blur-md",
              "tw:transition-[border-radius,border-color] tw:duration-200",
              filtersStuck && "tw:rounded-t-none tw:border-t-transparent",
            )}
          >
            <RiFilter3Line
              size={15}
              aria-hidden
              className="tw:ms-1 tw:flex-none tw:text-accent-text"
            />
            {activeFilters.map((appliedFilter) => (
              <button
                key={appliedFilter.key}
                type="button"
                onClick={appliedFilter.onRemove}
                title="Снять фильтр"
                className="tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1 tw:rounded-full tw:border-0 tw:bg-primary/15 tw:px-2.5 tw:py-1 tw:text-sm tw:font-medium tw:text-accent-text tw:outline-none tw:hover:bg-primary/25 tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
              >
                {appliedFilter.label}
                <RiCloseLine size={14} aria-hidden />
              </button>
            ))}
            <Button
              variant="ghost"
              size="xs"
              className="tw:ms-auto"
              onClick={resetFiltersHandler}
            >
              Сбросить
            </Button>
          </div>
        </div>
      )}
      {/* Пока данные есть — список стоит на месте: фоновый рефетч и навигация
          в шторку НЕ подменяют его спиннером. Никаких глобальных fade-обёрток —
          движение точечное, на уровне строк (tw:row-appear / tw:row-flash в
          ListRow). Спиннер — только у первой загрузки, когда показывать нечего.
          Пустые состояния предлагают действие (гайд): сброс/открытие фильтра
          при отфильтрованном в ноль списке, «Добавить …» при пустых данных. */}
      {!noData && (
        <div className="tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card tw:pb-1.5">
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
      {noData && isLoading && <Spinner />}
      {noData && !isLoading && (
        <div className="tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card tw:pb-1.5">
          <EmptyState
            icon={RiInboxLine}
            title="Список пуст"
            hint={
              showAddButton && !hiddenAddButton && (addRoute || onAddClick)
                ? "Добавьте первую запись — она появится здесь."
                : "Здесь пока ничего нет."
            }
          >
            {addButton(false)}
          </EmptyState>
        </div>
      )}
      {renderOutlet && (
        <FormSheet
          open={offcanvas.isActive}
          onOpenChange={(open) => {
            if (!open) {
              navigate(-1);
              offcanvas.setClose();
            }
          }}
        >
          <Outlet />
        </FormSheet>
      )}
    </div>
  );
};

export default ListWrapper;
