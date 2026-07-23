import { useMemo, useState } from "react";

import { RiCloseLine, RiSearchLine } from "react-icons/ri";

import FilterContainer from "@/components/app/FilterContainer";
import Segmented from "@/components/app/Segmented";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import useTicketTemplateFilterStore from "../../store/lists/ticket-templates";

const uniqueBy = (arr, keyFn) => {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
};

const fullName = (person) =>
  `${person?.lastName ?? ""} ${person?.firstName ?? ""}`.trim();

const ACCESS_OPTIONS = [
  { value: "all", label: "Все" },
  { value: "staff", label: "Сотрудникам" },
  { value: "clients", label: "Клиентам" },
  { value: "private", label: "Личные" },
];

const LIST_LIMIT = 8;

const Facet = ({ title, count, children }) => (
  <div className="tw:border-b tw:border-border-soft tw:py-3.5 tw:first:pt-1 tw:last:border-b-0">
    <div className="tw:mb-2.5 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
      {title}
      {count > 0 && (
        <span className="tw:font-bold tw:tracking-normal tw:text-accent-text tw:tabular-nums">
          {count}
        </span>
      )}
    </div>
    {children}
  </div>
);

const CheckRow = ({ id, checked, onToggle, label, count }) => (
  <label
    htmlFor={id}
    className="tw:flex tw:cursor-pointer tw:items-center tw:gap-2.5 tw:py-1.5 tw:text-sm"
  >
    <Checkbox id={id} checked={!!checked} onCheckedChange={onToggle} />
    <span
      className={cn(
        "tw:min-w-0 tw:flex-1 tw:truncate",
        count === 0 && "tw:text-faint",
      )}
    >
      {label}
    </span>
    <span className="tw:text-xs tw:text-faint tw:tabular-nums">{count}</span>
  </label>
);

// Фасет с поиском для длинных списков (компании 30+, пользователи 500+):
// поиск · выбранные чипами сверху · список со счётчиками · «+N ещё».
const SearchableMultiFacet = ({
  title,
  placeholder,
  idPrefix,
  options,
  selectedValues,
  onToggle,
}) => {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const matched = normalized
    ? options.filter((option) => option.label.toLowerCase().includes(normalized))
    : options;
  const shown = matched.slice(0, LIST_LIMIT);
  const remaining = matched.length - shown.length;
  const selected = options.filter((option) =>
    selectedValues.includes(option.value),
  );

  return (
    <Facet title={title} count={selectedValues.length}>
      <div className="tw:relative tw:mb-2">
        <RiSearchLine className="tw:pointer-events-none tw:absolute tw:top-1/2 tw:left-2.5 tw:size-4 tw:-translate-y-1/2 tw:text-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="tw:h-9 tw:w-full tw:appearance-none tw:rounded-md tw:border tw:border-input tw:bg-transparent tw:py-1 tw:pr-2 tw:pl-8 tw:text-sm tw:text-foreground tw:outline-none tw:placeholder:text-faint tw:focus-visible:border-ring tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
        />
      </div>
      {selected.length > 0 && (
        <div className="tw:mb-2 tw:flex tw:flex-wrap tw:gap-1.5">
          {selected.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              className="tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1 tw:rounded-full tw:border-0 tw:bg-primary/15 tw:py-1 tw:pr-1.5 tw:pl-2.5 tw:text-xs tw:font-medium tw:text-accent-text tw:outline-none tw:hover:bg-primary/25"
            >
              {option.label}
              <RiCloseLine className="tw:size-3.5" />
            </button>
          ))}
        </div>
      )}
      <div className="tw:max-h-56 tw:overflow-y-auto">
        {shown.map((option) => (
          <CheckRow
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            checked={selectedValues.includes(option.value)}
            onToggle={() => onToggle(option.value)}
            label={option.label}
            count={option.count}
          />
        ))}
        {matched.length === 0 && (
          <div className="tw:py-2 tw:text-sm tw:text-faint">Ничего не нашлось</div>
        )}
      </div>
      {remaining > 0 && (
        <div className="tw:pt-1.5 tw:text-xs tw:text-faint">
          + {remaining} ещё — уточните поиск
        </div>
      )}
    </Facet>
  );
};

// Sheet-фильтр шаблонов по согласованному макету: сегмент «Доступ», чекбокс-
// списки со счётчиками (категория, автор), searchable-фасеты (компании, пользователи).
// Компания также доступна чип-combobox'ом в строке инструментов — единое состояние.
const TicketTemplateFilter = () => {
  const filterStore = useTicketTemplateFilterStore();
  const list = filterStore.originalList ?? [];

  const withCount = (items, keyFn, labelFn, matches) =>
    uniqueBy(items, keyFn)
      .map((entry) => ({
        value: keyFn(entry),
        label: labelFn(entry),
        count: list.filter((template) => matches(template, keyFn(entry))).length,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

  const categoryOptions = useMemo(
    () =>
      withCount(
        list.map((template) => template.categoryId).filter(Boolean),
        (category) => category._id?.toString(),
        (category) => category.title,
        (template, value) => template.categoryId?._id?.toString() === value,
      ),
    [list],
  );

  const companyOptions = useMemo(
    () =>
      withCount(
        list.flatMap((template) => template.sharedCompanies ?? []),
        (company) => company._id?.toString(),
        (company) => company.alias,
        (template, value) =>
          (template.sharedCompanies ?? []).some(
            (shared) => shared._id?.toString() === value,
          ),
      ),
    [list],
  );

  const userOptions = useMemo(
    () =>
      withCount(
        list.flatMap((template) => template.sharedUsers ?? []),
        (user) => user._id?.toString(),
        (user) => fullName(user) || "Без имени",
        (template, value) =>
          (template.sharedUsers ?? []).some(
            (shared) => shared._id?.toString() === value,
          ),
      ),
    [list],
  );

  const authorOptions = useMemo(
    () =>
      withCount(
        list.map((template) => template.createdBy).filter((author) => author?._id),
        (author) => author._id?.toString(),
        (author) => fullName(author) || "Неизвестно",
        (template, value) => template.createdBy?._id?.toString() === value,
      ),
    [list],
  );

  const setAccess = (value) => {
    filterStore.updateFilter({ ...filterStore, access: value });
    filterStore.applyFilter();
  };

  const toggleValue = (field, value) => {
    const current = filterStore[field] ?? [];
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
    filterStore.updateFilter({ ...filterStore, [field]: next });
    filterStore.applyFilter();
  };

  return (
    <FilterContainer resetFilterHandler={filterStore.resetFilter}>
      <Facet title="Доступ">
        <Segmented
          options={ACCESS_OPTIONS}
          value={filterStore.access ?? "all"}
          onChange={setAccess}
          ariaLabel="Доступ"
        />
      </Facet>

      <Facet title="Категория" count={(filterStore.categories ?? []).length}>
        {categoryOptions.map((option) => (
          <CheckRow
            key={option.value}
            id={`f-cat-${option.value}`}
            checked={filterStore.categories?.includes(option.value)}
            onToggle={() => toggleValue("categories", option.value)}
            label={option.label}
            count={option.count}
          />
        ))}
      </Facet>

      <SearchableMultiFacet
        title="Компании"
        placeholder="Найти компанию"
        idPrefix="f-co"
        options={companyOptions}
        selectedValues={filterStore.companies ?? []}
        onToggle={(value) => toggleValue("companies", value)}
      />

      <SearchableMultiFacet
        title="Пользователи"
        placeholder="Найти пользователя"
        idPrefix="f-user"
        options={userOptions}
        selectedValues={filterStore.sharedUsers ?? []}
        onToggle={(value) => toggleValue("sharedUsers", value)}
      />

      <Facet title="Автор" count={(filterStore.authors ?? []).length}>
        {authorOptions.map((option) => (
          <CheckRow
            key={option.value}
            id={`f-author-${option.value}`}
            checked={filterStore.authors?.includes(option.value)}
            onToggle={() => toggleValue("authors", option.value)}
            label={option.label}
            count={option.count}
          />
        ))}
      </Facet>
    </FilterContainer>
  );
};

export default TicketTemplateFilter;
