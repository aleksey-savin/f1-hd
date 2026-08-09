import { useContext } from "react";
import { Link } from "react-router";

import {
  RiAddFill,
  RiArrowDownSLine,
  RiCloseLine,
  RiFilter3Line,
} from "react-icons/ri";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import SearchBar from "@/components/app/SearchBar";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";

import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getNoteTypeMeta } from "../../util/knowledgeNoteTypes";
import { bindingLabel } from "../../util/knowledgeNoteBindings";

import NoteList from "./NoteList";
import NoteBulkActionBar from "./NoteBulkActionBar";
import { useCan } from "@/store/authed-user";
import KnowledgeBaseFilter, {
  ModerationMenu,
  isFilterActive,
  MODERATION_FILTERS,
} from "./Filter";

// Сортировка ссылкой-дропдауном, а не полноразмерным селектом: её меняют раз в
// сессию, а место она занимает постоянно.
const SortMenu = () => {
  const sortBy = useKnowledgeNotesStore((state) => state.sortBy);
  const sortingOptions = useKnowledgeNotesStore(
    (state) => state.sortingOptions,
  );
  const handleSorting = useKnowledgeNotesStore((state) => state.handleSorting);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="ms-auto font-medium text-muted-foreground"
        >
          {sortBy.label}
          <RiArrowDownSLine aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={sortBy.label}
          onValueChange={(label) => {
            const option = sortingOptions.find((item) => item.label === label);
            if (option) handleSorting(option);
          }}
        >
          {sortingOptions.map((option) => (
            <DropdownMenuRadioItem key={option.label} value={option.label}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// Применённое всегда видно: снимаемый бейдж на каждое условие фильтра
// (docs/ux-ui-guide.md → «Применённые фильтры всегда видны»).
const useAppliedFilters = () => {
  const store = useKnowledgeNotesStore();
  const {
    scope,
    setScope,
    moderationMode,
    setModerationMode,
    enabledTypes,
    updateFilter,
    applyFilter,
    refresh,
  } = store;

  const applied = [];

  const queue = MODERATION_FILTERS.find((item) => item.mode === moderationMode);
  if (queue) {
    applied.push({
      key: "queue",
      label: `Очередь: ${queue.label}`,
      onRemove: () => setModerationMode(null),
    });
  }

  if (scope === "archived") {
    applied.push({
      key: "scope",
      label: "Архив",
      onRemove: () => setScope("active"),
    });
  }

  Object.entries(enabledTypes || {}).forEach(([type, on]) => {
    if (on === false) {
      applied.push({
        key: `type-${type}`,
        label: `Скрыт: ${getNoteTypeMeta(type).label}`,
        onRemove: () => {
          updateFilter({ enabledTypes: { ...enabledTypes, [type]: true } });
          applyFilter();
        },
      });
    }
  });

  [
    ["companies", "company", "Компания"],
    ["categories", "category", "Категория"],
    ["users", "user", "Пользователь"],
  ].forEach(([key, kind, caption]) => {
    (store[key] || []).forEach((item) => {
      applied.push({
        key: `${key}-${item._id}`,
        label: `${caption}: ${bindingLabel(kind, item)}`,
        onRemove: () => {
          updateFilter({
            [key]: store[key].filter((selected) => selected._id !== item._id),
          });
          refresh();
        },
      });
    });
  });

  return applied;
};

// Проводник по базе знаний — левая колонка раздела (двухпанельная раскладка,
// см. pages/KnowledgeBase/List.jsx).
//
// Над списком ровно два ряда: поиск с очередями, фильтром и созданием — и
// строка состояния. Набор данных, типы и привязки живут в шторке фильтра,
// применённое возвращается снимаемыми бейджами: каждый постоянный контрол
// стоил бы списку 40+ пикселей, а трогают их редко.
//
// На мобилке эту роль играет pages/KnowledgeBase/List.jsx поверх ListWrapper.
const KnowledgeBaseExplorer = () => {
  const { isAdmin } = useContext(AuthedUserContext);
  const can = useCan();
  const canManage = isAdmin || can({ knowledgeBase: ["manage"] });

  const store = useKnowledgeNotesStore();
  const { filteredList, searchTerm, fullTextSearch, resetFilter } = store;

  const filterOffcanvas = useMobileFilterOffcanvasStore();
  const applied = useAppliedFilters();
  const filterActive = isFilterActive(store);
  const canReset = filterActive || !!searchTerm.trim();

  return (
    // Рейл липнет под фиксированным баром; скроллится только панель списка.
    // На узком десктопе колонка ужимается, но не прячется: без неё раздел
    // теряет навигацию — заметки открываются только отсюда.
    <div className="sticky top-20 flex w-80 flex-none flex-col gap-2 xl:w-86">
      <div className="flex items-center gap-2">
        <SearchBar
          className="min-w-0 flex-1"
          placeholder="Найти в заметках…"
          value={searchTerm}
          onChange={(event) => fullTextSearch(event.target.value)}
        />
        <ModerationMenu />
        <Button
          variant={filterActive ? "success" : "outline"}
          size="icon"
          title="Фильтр"
          aria-label="Фильтр"
          onClick={filterOffcanvas.handleShow}
        >
          <RiFilter3Line />
        </Button>
        {canManage && (
          <Button
            asChild
            size="icon"
            title="Новая заметка"
            aria-label="Новая заметка"
          >
            <Link to="/knowledge-base/add">
              <RiAddFill />
            </Link>
          </Button>
        )}
      </div>

      {applied.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1.5">
          {applied.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onRemove}
              title="Снять фильтр"
              className="inline-flex cursor-pointer appearance-none items-center gap-1 rounded-full border-0 bg-primary/15 px-2.5 py-1 text-sm font-medium text-accent-text outline-none hover:bg-primary/25 focus-visible:ring-4 focus-visible:ring-ring/50"
            >
              {item.label}
              <RiCloseLine size={14} aria-hidden />
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground tabular-nums">
        <span>Найдено: {filteredList.length}</span>
        {canReset && (
          <button
            type="button"
            onClick={resetFilter}
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Сбросить
          </button>
        )}
        <SortMenu />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Скроллится только список: поиск, бейджи и строка состояния стоят */}
        <div
          className="overflow-y-auto"
          style={{ maxHeight: "calc(100svh - 190px)" }}
        >
          <NoteList />
        </div>
      </div>

      <Sheet
        open={filterOffcanvas.isActive}
        onOpenChange={(open) => {
          if (!open) filterOffcanvas.handleClose();
        }}
      >
        <SheetContent side="left" className="w-5/6 max-w-sm">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="text-base">Фильтр</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <KnowledgeBaseFilter />
          </div>
        </SheetContent>
      </Sheet>

      <NoteBulkActionBar />
    </div>
  );
};

export default KnowledgeBaseExplorer;
