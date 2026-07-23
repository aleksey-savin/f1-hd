import { useEffect } from "react";
import { useLocation } from "react-router";

import { RiStackLine } from "react-icons/ri";

import Segmented from "@/components/app/Segmented";
import ChipCombobox from "@/components/app/ChipCombobox";
import ListWrapper from "@/components/app/ListWrapper";
import Pager from "@/components/app/Pager";
import { cn } from "@/lib/utils";

import useUserFilterStore from "../../store/lists/users";
import usePolling from "../../hooks/use-polling";
import { getLocalStorageData } from "../../util/auth";

import List from "../../components/User/List";
import UserFilter from "../../components/User/Filter";

const AUDIENCE_OPTIONS = [
  { value: "all", label: "Все" },
  { value: "staff", label: "Сотрудники" },
  { value: "clients", label: "Клиенты" },
];
const AUDIENCE_LABEL = Object.fromEntries(
  AUDIENCE_OPTIONS.map((option) => [option.value, option.label]),
);
const ACTIVITY_LABEL = {
  currentMonth: "в этом месяце",
  currentYear: "в этом году",
  inactive6m: "неактивные",
};

const Users = () => {
  const location = useLocation();
  const s = useUserFilterStore();

  // Первичная загрузка (и рефетч после возврата на список — напр. после
  // удаления/правки, когда action редиректит на /users). Взаимодействия с
  // фильтрами/сортировкой/страницами делают запрос сами, не через location.
  useEffect(() => {
    // Зависимость — объект location (меняется по key на каждую навигацию, в т.ч.
    // редирект delete/toggle на тот же /users): гард по pathname не даёт лишний
    // рефетч при открытой шторке формы (/users/add, /users/update/:id).
    if (location.pathname === "/users") s.fetch();
  }, [location]);

  // Список компаний для фасета (лёгкий, scoped на бэкенде).
  useEffect(() => {
    const { token } = getLocalStorageData();
    fetch(`${import.meta.env.VITE_API_ADDRESS}/api/users/companies`, {
      headers: { Authorization: "Bearer " + token },
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) =>
        s.setCompanyOptions(
          (data || []).map((company) => ({
            value: company._id,
            label: company.alias,
          })),
        ),
      )
      .catch(() => {});
  }, []);

  // Живые статусы присутствия — фоновый мёрдж без перезагрузки списка.
  usePolling(() => s.silentRefresh(), { intervalMs: 15000 });

  const grouped = s.groupBySubdivision && !!s.company;

  // Применённые фильтры → липкий остров (лейблы человеческие).
  const activeFilters = [];
  if (s.audience !== "clients")
    activeFilters.push({
      key: "audience",
      label: `Набор: ${AUDIENCE_LABEL[s.audience]}`,
      onRemove: () => s.setAudience("clients"),
    });
  if (s.company)
    activeFilters.push({
      key: "company",
      label: `Компания: ${
        s.companyOptions.find((option) => option.value === s.company)?.label ??
        "выбрана"
      }`,
      onRemove: () => s.setCompany(null),
    });
  if (s.online)
    activeFilters.push({
      key: "online",
      label: "Только на связи",
      onRemove: () => s.updateFilter({ online: false }),
    });
  if (s.activity !== "any")
    activeFilters.push({
      key: "activity",
      label: `Активность: ${ACTIVITY_LABEL[s.activity] ?? s.activity}`,
      onRemove: () => s.updateFilter({ activity: "any" }),
    });
  if (!s.activeOnly)
    activeFilters.push({
      key: "inactive",
      label: "С отключёнными",
      onRemove: () => s.updateFilter({ activeOnly: true }),
    });
  if (s.includeService)
    activeFilters.push({
      key: "service",
      label: "Со служебными",
      onRemove: () => s.updateFilter({ includeService: false }),
    });

  const hasActiveQuery = activeFilters.length > 0 || !!s.searchTerm;

  const toolbar = (
    <>
      <Segmented
        options={AUDIENCE_OPTIONS}
        value={s.audience}
        onChange={(value) => s.setAudience(value)}
        ariaLabel="Набор пользователей"
      />
      {/* компания и группировка — быстрый доступ на десктопе; на мобайле они
          живут в фильтр-шторке (display:contents прячет обёртку из флекса) */}
      <span className="tw:hidden tw:md:contents">
        <ChipCombobox
          placeholder="Компания"
          allLabel="Все компании"
          value={s.company}
          options={s.companyOptions}
          onChange={(value) => s.setCompany(value)}
        />
        {s.company && (
          <button
            type="button"
            onClick={() => s.toggleGroupBySubdivision()}
            title="Группировать по подразделению"
            className={cn(
              "tw:inline-flex tw:h-10 tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:rounded-full tw:border tw:border-input tw:bg-transparent tw:px-4 tw:text-sm tw:font-semibold tw:whitespace-nowrap tw:text-muted-foreground tw:transition-colors tw:outline-none tw:hover:bg-accent tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
              grouped &&
                "tw:border-transparent tw:bg-primary/15 tw:text-accent-text tw:hover:bg-primary/20",
            )}
          >
            <RiStackLine size={15} aria-hidden />
            По подразделению
          </button>
        )}
      </span>
    </>
  );

  return (
    <ListWrapper
      title={() => "Пользователи"}
      count={s.total}
      hasActiveQuery={hasActiveQuery}
      filterStore={s}
      filter={<UserFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
      toolbar={toolbar}
      addRoute="/users/add"
      addLabel="Новый пользователь"
      belowList={
        grouped ? null : (
          <Pager
            page={s.page}
            pageSize={s.pageSize}
            total={s.total}
            loaded={s.items.length}
            onPage={(page) => s.setPage(page)}
            onLoadMore={() => s.loadMore()}
          />
        )
      }
    >
      <List items={s.items} grouped={grouped} />
    </ListWrapper>
  );
};

export default Users;

export async function loader() {
  document.title = "Пользователи";
  return null;
}
