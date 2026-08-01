import { useMemo } from "react";

import { RiShieldCheckLine } from "react-icons/ri";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FilterChip from "@/components/app/FilterChip";
import FilterContainer from "@/components/app/FilterContainer";
import Segmented from "@/components/app/Segmented";
import { cn } from "@/lib/utils";

import { MultiCombobox, toOptions } from "@/components/app/Combobox";
import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import useInitialPrefsStore from "../../store/prefs";
import { NOTE_TYPES } from "../../util/knowledgeNoteTypes";
import { bindingLabel } from "../../util/knowledgeNoteBindings";
import useModerationSummary from "./useModerationSummary";

// Уникальные объекты по _id
const uniqueById = (items) => {
  const map = new Map();
  items.forEach((item) => {
    if (item?._id) {
      map.set(item._id.toString(), item);
    }
  });
  return [...map.values()];
};

// Очереди модерации. Ключи режимов совпадают с deep-link'ом ?moderation=…,
// по которому в базу знаний ведут карточки со страницы заявок.
export const MODERATION_FILTERS = [
  { mode: "all-unapproved", label: "На проверку", countKey: "pendingApproval" },
  {
    mode: "pending-deletion",
    label: "На удаление",
    countKey: "pendingDeletion",
  },
  {
    mode: "pending-archive",
    label: "На архивацию",
    countKey: "pendingArchive",
  },
  {
    mode: "flagged-secrets",
    label: "Учётные данные",
    countKey: "secretsFlagged",
    needsSecretsScan: true,
  },
];

// Подпись поля фильтра. С htmlFor — настоящий <label> (клик фокусирует
// контрол), без него — просто метка группы: связывать её не с чем (сегмент,
// набор чипов), а «label в никуда» — это баг доступности.
const FieldLabel = ({ htmlFor, children }) => {
  const className =
    "mb-1.5 block text-xs font-bold tracking-wider text-faint uppercase";

  return htmlFor ? (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ) : (
    <div className={className}>{children}</div>
  );
};

// Набор данных: активные заметки или архив — взаимоисключающие наборы.
const ScopeSwitch = () => {
  const scope = useKnowledgeNotesStore((state) => state.scope);
  const setScope = useKnowledgeNotesStore((state) => state.setScope);

  return (
    <Segmented
      ariaLabel="Набор заметок"
      value={scope}
      onChange={setScope}
      options={[
        { value: "active", label: "Активные" },
        { value: "archived", label: "Архив" },
      ]}
    />
  );
};

// Чипы типов со счётчиками по загруженному набору. Выключение типа убирает его
// заметки из выдачи; по умолчанию включены все.
const TypeChips = () => {
  const originalList = useKnowledgeNotesStore((state) => state.originalList);
  const enabledTypes = useKnowledgeNotesStore((state) => state.enabledTypes);
  const updateFilter = useKnowledgeNotesStore((state) => state.updateFilter);
  const applyFilter = useKnowledgeNotesStore((state) => state.applyFilter);

  const counts = useMemo(() => {
    const result = {};
    originalList.forEach((note) => {
      const type = note.type || "info";
      result[type] = (result[type] || 0) + 1;
    });
    return result;
  }, [originalList]);

  const toggle = (value) => {
    updateFilter({
      enabledTypes: {
        ...enabledTypes,
        [value]: !(enabledTypes?.[value] ?? true),
      },
    });
    applyFilter();
  };

  return (
    <div className="flex flex-wrap gap-2">
      {NOTE_TYPES.map((type) => {
        const Icon = type.icon;
        const checked = enabledTypes?.[type.value] ?? true;
        return (
          <FilterChip
            key={type.value}
            active={checked}
            onClick={() => toggle(type.value)}
            className="h-9 px-3"
          >
            <Icon size={15} aria-hidden />
            {type.label}
            <span className="tabular-nums">{counts[type.value] || 0}</span>
          </FilterChip>
        );
      })}
    </div>
  );
};

// Очереди модерации одной кнопкой-чипом со счётчиком: четыре чипа с заголовком
// секции съедали у списка сотню пикселей, а очередь разбирают не каждый день
// (docs/ux-ui-guide.md → «Бюджет управляющих элементов»).
export const ModerationMenu = ({ className }) => {
  const scope = useKnowledgeNotesStore((state) => state.scope);
  const moderationMode = useKnowledgeNotesStore(
    (state) => state.moderationMode,
  );
  const setModerationMode = useKnowledgeNotesStore(
    (state) => state.setModerationMode,
  );
  const scanForSecrets = useInitialPrefsStore(
    (state) => state.knowledgeBase.scanForSecrets,
  );
  const { counts, isModerator } = useModerationSummary();

  if (!isModerator || scope === "archived") {
    return null;
  }

  const filters = MODERATION_FILTERS.filter(
    (item) => !item.needsSecretsScan || scanForSecrets,
  );
  const active = filters.find((item) => item.mode === moderationMode);
  // Вне очереди — сколько ЗАМЕТОК ждёт разбора (счётчик от бэкенда): суммировать
  // очереди нельзя, они пересекаются — одна заметка бывает и непроверенной, и с
  // находкой сканера сразу
  const count = active ? counts?.[active.countKey] || 0 : counts?.total || 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={active ? `Очередь: ${active.label}` : "Очереди модерации"}
          aria-label="Очереди модерации"
          className={cn(
            "inline-flex h-9 cursor-pointer appearance-none items-center gap-1.5 rounded-full border border-input bg-transparent px-3 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50",
            active &&
              "border-transparent bg-primary/15 text-accent-text hover:bg-primary/20",
            className,
          )}
        >
          <RiShieldCheckLine size={17} aria-hidden />
          {count > 0 && (
            <span className="rounded-full bg-foreground/10 px-1.5 text-xs font-bold tabular-nums">
              {count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Очереди модерации</DropdownMenuLabel>
        {filters.map((item) => (
          <DropdownMenuItem
            key={item.mode}
            onSelect={() => setModerationMode(item.mode)}
            className={cn(item.mode === moderationMode && "bg-accent")}
          >
            {item.label}
            <span className="ms-auto text-faint tabular-nums">
              {counts?.[item.countKey] || 0}
            </span>
          </DropdownMenuItem>
        ))}
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setModerationMode(null)}>
              Выйти из очереди
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// Скоуп-фильтры по привязкам. Опции берём из уже загруженных заметок — отдельный
// запрос за справочниками здесь не нужен. К ним всегда домешиваем уже выбранные
// значения: серверный поиск сужает набор заметок, и без этого выбранная компания
// исчезала бы из собственного селекта, стоило ввести запрос.
const BindingFilters = () => {
  const store = useKnowledgeNotesStore();
  const { originalList, updateFilter, refresh } = store;

  const options = useMemo(
    () => ({
      companies: uniqueById([
        ...originalList.flatMap((note) => note.companies || []),
        ...store.companies,
      ]),
      users: uniqueById([
        ...originalList.flatMap((note) => note.users || []),
        ...store.users,
      ]),
      categories: uniqueById([
        ...originalList.flatMap((note) => note.categories || []),
        ...store.categories,
      ]),
    }),
    [originalList, store.companies, store.users, store.categories],
  );

  // Выбор скоуп-фильтра выводит из режима модерации: очередь его игнорирует.
  const change = (key) => (selected) => {
    updateFilter({ [key]: selected || [], moderationMode: null });
    refresh();
  };

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel htmlFor="kb-filter-companies">Компании</FieldLabel>
        <MultiCombobox
          id="kb-filter-companies"
          placeholder="Все компании"
          value={(store.companies || []).map((item) => String(item._id))}
          options={toOptions(options.companies, {
            value: (option) => String(option._id),
            label: (option) => bindingLabel("company", option),
          })}
          onChange={(ids) =>
            change("companies")(
              options.companies.filter((option) =>
                ids.includes(String(option._id)),
              ),
            )
          }
        />
      </div>
      <div>
        <FieldLabel htmlFor="kb-filter-categories">Категории заявок</FieldLabel>
        <MultiCombobox
          id="kb-filter-categories"
          placeholder="Все категории"
          value={(store.categories || []).map((item) => String(item._id))}
          options={toOptions(options.categories, {
            value: (option) => String(option._id),
            label: (option) => bindingLabel("category", option),
          })}
          onChange={(ids) =>
            change("categories")(
              options.categories.filter((option) =>
                ids.includes(String(option._id)),
              ),
            )
          }
        />
      </div>
      <div>
        <FieldLabel htmlFor="kb-filter-users">Пользователи</FieldLabel>
        <MultiCombobox
          id="kb-filter-users"
          placeholder="Все пользователи"
          value={(store.users || []).map((item) => String(item._id))}
          options={toOptions(options.users, {
            value: (option) => String(option._id),
            label: (option) => bindingLabel("user", option),
          })}
          onChange={(ids) =>
            change("users")(
              options.users.filter((option) =>
                ids.includes(String(option._id)),
              ),
            )
          }
        />
      </div>
    </div>
  );
};

// Всё, что применено к списку помимо поиска: привязки, архив, выключенные типы.
const activeFilterCount = (state) =>
  (state.companies?.length || 0) +
  (state.users?.length || 0) +
  (state.categories?.length || 0) +
  (state.scope === "archived" ? 1 : 0) +
  Object.values(state.enabledTypes || {}).filter((on) => on === false).length;

// Отличается ли состояние списка от значений по умолчанию (поиск не считаем —
// у него свой видимый индикатор: непустое поле).
export const isFilterActive = (state) =>
  activeFilterCount(state) > 0 || !!state.moderationMode;

// Тело шторки фильтра — общее для десктопного рейла и мобильного списка.
const KnowledgeBaseFilter = () => {
  const resetFilter = useKnowledgeNotesStore((state) => state.resetFilter);

  return (
    <FilterContainer resetFilterHandler={resetFilter}>
      <div className="space-y-4 pt-4">
        <div>
          <FieldLabel>Набор</FieldLabel>
          <ScopeSwitch />
        </div>
        <div>
          <FieldLabel>Тип заметки</FieldLabel>
          <TypeChips />
        </div>
        <BindingFilters />
      </div>
    </FilterContainer>
  );
};

export default KnowledgeBaseFilter;
