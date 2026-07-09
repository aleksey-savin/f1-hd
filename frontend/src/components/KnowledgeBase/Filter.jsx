import { useMemo } from "react";

import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Dropdown from "react-bootstrap/Dropdown";
import Stack from "react-bootstrap/Stack";
import ToggleButton from "react-bootstrap/ToggleButton";
import ToggleButtonGroup from "react-bootstrap/ToggleButtonGroup";

import { RiShieldCheckLine } from "react-icons/ri";

import Select from "../../UI/Select";
import FilterContainer from "../../UI/FilterContainer";
import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import useInitialPrefsStore from "../../store/prefs";
import { NOTE_TYPES } from "../../util/knowledgeNoteTypes";
import { bindingLabel } from "./BindingChips";
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
  { mode: "pending-deletion", label: "На удаление", countKey: "pendingDeletion" },
  { mode: "pending-archive", label: "На архивацию", countKey: "pendingArchive" },
  {
    mode: "flagged-secrets",
    label: "Учётные данные",
    countKey: "secretsFlagged",
    needsSecretsScan: true,
  },
];

// Набор данных: активные заметки или архив. Это взаимоисключающие наборы, и
// сегментный переключатель показывает это честнее, чем свитч «Показать архив».
export const ScopeSwitch = () => {
  const scope = useKnowledgeNotesStore((state) => state.scope);
  const setScope = useKnowledgeNotesStore((state) => state.setScope);

  return (
    <ToggleButtonGroup
      type="radio"
      name="kb-scope"
      size="sm"
      value={scope}
      onChange={setScope}
      className="w-100"
    >
      <ToggleButton id="kb-scope-active" value="active" variant="outline-secondary">
        Активные
      </ToggleButton>
      <ToggleButton
        id="kb-scope-archived"
        value="archived"
        variant="outline-secondary"
      >
        Архив
      </ToggleButton>
    </ToggleButtonGroup>
  );
};

// Чипы типов со счётчиками по загруженному набору. Выключение типа убирает его
// заметки из выдачи; по умолчанию включены все.
export const TypeChips = () => {
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
    <Stack direction="horizontal" gap={2} className="flex-wrap">
      {NOTE_TYPES.map((type) => {
        const checked = enabledTypes?.[type.value] ?? true;
        return (
          <ToggleButton
            key={type.value}
            id={`kb-type-${type.value}`}
            type="checkbox"
            size="sm"
            value={type.value}
            checked={checked}
            variant={checked ? type.badge : "outline-secondary"}
            onChange={() => toggle(type.value)}
          >
            {type.label} <Badge bg="dark">{counts[type.value] || 0}</Badge>
          </ToggleButton>
        );
      })}
    </Stack>
  );
};

// Сумма всех очередей — столько всего ждёт модератора.
const totalPending = (counts, filters) =>
  filters.reduce((sum, item) => sum + (counts?.[item.countKey] || 0), 0);

// Очереди модерации для десктопной колонки: одна иконка-кнопка со счётчиком
// вместо четырёх чипов с заголовком. В колонке шириной в треть экрана они
// съедали сотню пикселей у списка — а очередь разбирают не каждый день.
export const ModerationMenu = ({ counts }) => {
  const scope = useKnowledgeNotesStore((state) => state.scope);
  const moderationMode = useKnowledgeNotesStore((state) => state.moderationMode);
  const setModerationMode = useKnowledgeNotesStore(
    (state) => state.setModerationMode,
  );
  const isModerator = useInitialPrefsStore(
    (state) => state.knowledgeBase.isModerator,
  );
  const scanForSecrets = useInitialPrefsStore(
    (state) => state.knowledgeBase.scanForSecrets,
  );

  if (!isModerator || scope === "archived") {
    return null;
  }

  const filters = MODERATION_FILTERS.filter(
    (item) => !item.needsSecretsScan || scanForSecrets,
  );
  const active = filters.find((item) => item.mode === moderationMode);
  const count = active
    ? counts?.[active.countKey] || 0
    : totalPending(counts, filters);

  return (
    <Dropdown>
      <Dropdown.Toggle
        variant={active ? "primary" : "outline-secondary"}
        className="kb-queue-toggle"
        title={active ? `Очередь: ${active.label}` : "Очереди модерации"}
        aria-label="Очереди модерации"
      >
        <RiShieldCheckLine />
        {count > 0 && <span className="kb-queue__count">{count}</span>}
      </Dropdown.Toggle>
      <Dropdown.Menu align="end">
        <Dropdown.Header>Очереди модерации</Dropdown.Header>
        {filters.map((item) => (
          <Dropdown.Item
            key={item.mode}
            active={item.mode === moderationMode}
            onClick={() => setModerationMode(item.mode)}
          >
            {item.label}
            <Badge bg="secondary" className="ms-2">
              {counts?.[item.countKey] || 0}
            </Badge>
          </Dropdown.Item>
        ))}
        {active && (
          <>
            <Dropdown.Divider />
            <Dropdown.Item onClick={() => setModerationMode(null)}>
              Выйти из очереди
            </Dropdown.Item>
          </>
        )}
      </Dropdown.Menu>
    </Dropdown>
  );
};

// Те же очереди чипами — для мобильного offcanvas'а, где вертикали в избытке и
// все счётчики видны сразу. Раньше заголовок «Модерация» рендерился всем, а
// кнопки внутри — нет: обычный сотрудник видел пустой блок между двумя <hr>.
export const ModerationChips = ({ counts }) => {
  const scope = useKnowledgeNotesStore((state) => state.scope);
  const moderationMode = useKnowledgeNotesStore((state) => state.moderationMode);
  const setModerationMode = useKnowledgeNotesStore(
    (state) => state.setModerationMode,
  );
  const isModerator = useInitialPrefsStore(
    (state) => state.knowledgeBase.isModerator,
  );
  const scanForSecrets = useInitialPrefsStore(
    (state) => state.knowledgeBase.scanForSecrets,
  );

  if (!isModerator || scope === "archived") {
    return null;
  }

  const filters = MODERATION_FILTERS.filter(
    (item) => !item.needsSecretsScan || scanForSecrets,
  );

  return (
    <div>
      <h6 className="text-body-secondary text-uppercase small mb-2">
        Модерация
      </h6>
      <Stack direction="horizontal" gap={2} className="flex-wrap">
        {filters.map((item) => {
          const active = moderationMode === item.mode;
          return (
            <Button
              key={item.mode}
              size="sm"
              variant={active ? "primary" : "outline-secondary"}
              // Повторный клик по активной очереди — выход из неё
              onClick={() => setModerationMode(active ? null : item.mode)}
            >
              {item.label} <Badge bg="dark">{counts?.[item.countKey] || 0}</Badge>
            </Button>
          );
        })}
      </Stack>
    </div>
  );
};

// Скоуп-фильтры по привязкам. Опции берём из уже загруженных заметок — отдельный
// запрос за справочниками здесь не нужен. К ним всегда домешиваем уже выбранные
// значения: серверный поиск сужает набор заметок, и без этого выбранная компания
// исчезала бы из собственного селекта, стоило ввести запрос.
export const BindingFilters = () => {
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
    <Stack gap={2}>
      <Select
        placeholder="Компании"
        closeMenuOnSelect={false}
        isClearable
        isSearchable
        isMulti
        value={store.companies}
        options={options.companies}
        getOptionLabel={(option) => bindingLabel("company", option)}
        getOptionValue={(option) => option._id}
        onChange={change("companies")}
      />
      <Select
        placeholder="Пользователи"
        closeMenuOnSelect={false}
        isClearable
        isSearchable
        isMulti
        value={store.users}
        options={options.users}
        getOptionLabel={(option) => bindingLabel("user", option)}
        getOptionValue={(option) => option._id}
        onChange={change("users")}
      />
      <Select
        placeholder="Категории"
        closeMenuOnSelect={false}
        isClearable
        isSearchable
        isMulti
        value={store.categories}
        options={options.categories}
        getOptionLabel={(option) => bindingLabel("category", option)}
        getOptionValue={(option) => option._id}
        onChange={change("categories")}
      />
    </Stack>
  );
};

// Сколько скоуп-фильтров выбрано.
export const activeBindingFilterCount = (state) =>
  (state.companies?.length || 0) +
  (state.users?.length || 0) +
  (state.categories?.length || 0);

// Всё, что спрятано под «Фильтрами», — для бейджа на свёрнутом аккордеоне.
// Архив и выключенный тип должны считаться: иначе фильтр применён, а виду нет.
export const activeFilterCount = (state) =>
  activeBindingFilterCount(state) +
  (state.scope === "archived" ? 1 : 0) +
  Object.values(state.enabledTypes || {}).filter((on) => on === false).length;

// Отличается ли состояние списка от значений по умолчанию (поиск не считаем —
// у него свой видимый индикатор: непустое поле).
export const isFilterActive = (state) =>
  activeFilterCount(state) > 0 || !!state.moderationMode;

// Мобильная сборка фильтра — то же содержимое в offcanvas'е со «Сбросить».
const KnowledgeBaseFilter = () => {
  const resetFilter = useKnowledgeNotesStore((state) => state.resetFilter);
  const { counts } = useModerationSummary();

  return (
    <FilterContainer resetFilterHandler={resetFilter}>
      <Stack gap={3} className="mb-3">
        <ScopeSwitch />
        <TypeChips />
        <ModerationChips counts={counts} />
        <BindingFilters />
      </Stack>
    </FilterContainer>
  );
};

export default KnowledgeBaseFilter;
