import { type ChangeEvent, type ReactNode } from "react";

import { Link, Outlet, useNavigate } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";
import {
  RiAddFill,
  RiArrowDownSLine,
  RiArrowGoBackLine,
  RiFilter3Line,
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
import AlertMessage from "@/components/app/AlertMessage";
import FormSheet from "@/components/app/FormSheet";
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
};

type ListWrapperProps = {
  title: () => ReactNode;
  filter?: ReactNode;
  customData?: () => ReactNode;
  topContent?: ReactNode;
  /** Чипы/контролы в строке инструментов (например, FilterChip). */
  toolbar?: ReactNode;
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

  const isLoading = filterStore.isLoading || filterStore.isSorting;
  const hasData =
    Number(filterStore.filteredList?.length) > 0 ||
    Number(filterStore.originalList?.length) > 0;

  const searchHandler = (e: ChangeEvent<HTMLInputElement>) => {
    filterStore.fullTextSearch(e.target.value);
  };

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
        {filter && (
          <Sheet
            open={filterOffcanvas.isActive}
            onOpenChange={(open) => {
              if (!open) filterOffcanvas.handleClose();
            }}
          >
            <SheetContent side="left" className="tw:w-5/6">
              <SheetHeader className="tw:border-b tw:border-border">
                <SheetTitle className="tw:text-base">Фильтр</SheetTitle>
              </SheetHeader>
              <div className="tw:flex-1 tw:overflow-y-auto tw:px-4 tw:pb-4">
                {filter}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </MobileView>
      {topContent}
      {customData ? customData() : ""}
      {/* Пока данные есть — список стоит на месте: фоновый рефетч и навигация
          в шторку НЕ подменяют его спиннером. Никаких глобальных fade-обёрток —
          движение точечное, на уровне строк (tw:row-appear / tw:row-flash в
          ListRow). Спиннер — только у первой загрузки, когда показывать нечего. */}
      {hasData && (
        <div className="tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card tw:pb-1.5">
          {children}
        </div>
      )}
      {!hasData && isLoading && <Spinner />}
      {!hasData && !isLoading && (
        <AlertMessage variant="light" message="Список пуст" />
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
