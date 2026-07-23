import { useEffect, useMemo } from "react";
import { useLocation } from "react-router";

import ListWrapper from "@/components/app/ListWrapper";
import Segmented from "@/components/app/Segmented";
import { useAuthedUser } from "@/store/authed-user";

import useCompanyFilterStore, {
  getResponsibleId,
} from "../../store/lists/companies";

import List from "../../components/Company/List";
import CompanyFilter from "../../components/Company/Filter";

const SET_OPTIONS = [
  { value: "all", label: "Все" },
  { value: "mine", label: "Мои" },
];

const Companies = () => {
  const location = useLocation();
  const s = useCompanyFilterStore();
  const { _id: myId } = useAuthedUser();

  // Первичная загрузка и рефетч по возвращении на список (редирект после
  // удаления меняет location.key при том же pathname). Гард по pathname —
  // не дёргать список под открытой шторкой формы (/companies/add|update).
  useEffect(() => {
    if (location.pathname === "/companies") s.fetch();
  }, [location]);

  useEffect(() => {
    s.applyFilter();
  }, [s.originalList]);

  // Сегмент «Все | Мои» имеет смысл, только если он что-то сужает: я — в
  // ответственных хотя бы одной компании, но вижу не только свои.
  const mineApplicable = useMemo(() => {
    const list = s.originalList ?? [];
    const mineCount = list.filter((company) =>
      (company.responsibles ?? [])
        .map(getResponsibleId)
        .includes(String(myId)),
    ).length;
    return mineCount > 0 && mineCount < list.length;
  }, [s.originalList, myId]);

  // Имена ответственных для человеческих лейблов бейджей
  const responsibleNames = useMemo(() => {
    const names = new Map();
    (s.originalList ?? []).forEach((company) =>
      (company.responsibles ?? []).forEach((resp) => {
        const respId = getResponsibleId(resp);
        if (respId && !names.has(respId)) {
          names.set(
            respId,
            `${resp.lastName ?? ""} ${resp.firstName ?? ""}`.trim(),
          );
        }
      }),
    );
    return names;
  }, [s.originalList]);

  const activeFilters = [];
  if (s.mineOnly)
    activeFilters.push({
      key: "mine",
      label: "Только мои",
      onRemove: () => s.setMineOnly(false),
    });
  s.responsibles.forEach((id) =>
    activeFilters.push({
      key: `responsible-${id}`,
      label: `Ответственный: ${responsibleNames.get(id) || "выбран"}`,
      onRemove: () => s.toggleResponsible(id),
    }),
  );
  if (s.noResponsible)
    activeFilters.push({
      key: "no-responsible",
      label: "Без ответственного",
      onRemove: () => s.toggleNoResponsible(),
    });
  if (s.onlyWithServices)
    activeFilters.push({
      key: "with-services",
      label: "С услугами",
      onRemove: () => s.setOnlyWithServices(false),
    });
  if (!s.activeOnly)
    activeFilters.push({
      key: "inactive",
      label: "С отключёнными",
      onRemove: () => s.setActiveOnly(true),
    });

  const toolbar = mineApplicable ? (
    <Segmented
      options={SET_OPTIONS}
      value={s.mineOnly ? "mine" : "all"}
      onChange={(value) => s.setMineOnly(value === "mine", myId)}
      ariaLabel="Набор компаний"
    />
  ) : null;

  return (
    <>
      <ListWrapper
        title={() => "Компании"}
        filterStore={s}
        filter={<CompanyFilter />}
        filterActive={activeFilters.length > 0}
        activeFilters={activeFilters}
        toolbar={toolbar}
        addRoute="/companies/add"
        addLabel="Новая компания"
        wide
      >
        <List items={s.filteredList} />
      </ListWrapper>
    </>
  );
};

export default Companies;

export async function loader() {
  document.title = "Компании";

  return null;
}
