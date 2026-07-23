import { useEffect } from "react";
import { redirect, useLocation } from "react-router";

import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import ListWrapper from "@/components/app/ListWrapper";

import List from "../../components/RoutineTask/List";
import RoutineTaskFilter from "../../components/RoutineTask/Filter";
import useRoutineTaskFilterStore from "../../store/lists/routine-tasks";
import { getLocalStorageData } from "../../util/auth";

const pluralCompanies = (n) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "компания";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "компании";
  return "компаний";
};

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

const STATUS_LABEL = { active: "Активные", paused: "На паузе" };

const RoutineTasks = () => {
  const location = useLocation();
  const filterStore = useRoutineTaskFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  useEffect(() => {
    if (location.pathname === "/routine-tasks") {
      filterStore.fetch();
    }
  }, [location.key]);

  const list = filterStore.originalList ?? [];

  const companyOptions = uniqueBy(
    list.map((task) => task.company).filter(Boolean),
    (company) => company._id?.toString(),
  )
    .map((company) => ({ value: company._id.toString(), label: company.alias }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const setCompanies = (companies) => {
    filterStore.updateFilter({ ...filterStore, companies });
    filterStore.applyFilter();
  };

  const removeFilter = (patch) => {
    filterStore.updateFilter({ ...filterStore, ...patch });
    filterStore.applyFilter();
  };

  const categoryTitleOf = (id) =>
    list.map((task) => task.category).find((c) => c?._id?.toString() === id)
      ?.title ?? id;

  const activeFilters = [
    filterStore.status &&
      filterStore.status !== "all" && {
        key: "status",
        label: `Статус: ${STATUS_LABEL[filterStore.status]}`,
        onRemove: () => removeFilter({ status: "all" }),
      },
    ...(filterStore.companies ?? []).map((id) => ({
      key: `company-${id}`,
      label: `Компания: ${
        companyOptions.find((o) => o.value === id)?.label ?? id
      }`,
      onRemove: () =>
        removeFilter({
          companies: filterStore.companies.filter((entry) => entry !== id),
        }),
    })),
    ...(filterStore.categories ?? []).map((id) => ({
      key: `category-${id}`,
      label: `Категория: ${categoryTitleOf(id)}`,
      onRemove: () =>
        removeFilter({
          categories: filterStore.categories.filter((c) => c !== id),
        }),
    })),
  ].filter(Boolean);

  return (
    <ListWrapper
      title={() => "Регламенты"}
      filterStore={filterStore}
      addRoute="/routine-tasks/add"
      addLabel="Новый регламент"
      toolbar={
        <ChipMultiCombobox
          placeholder="Компания"
          searchPlaceholder="Найти компанию"
          countLabel={(n) => `${n} ${pluralCompanies(n)}`}
          value={filterStore.companies ?? []}
          options={companyOptions}
          onChange={setCompanies}
        />
      }
      filter={<RoutineTaskFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
      formWide
    >
      <List items={filterStore.filteredList} />
    </ListWrapper>
  );
};

export default RoutineTasks;

export async function loader() {
  document.title = "Регламенты";
  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/routine-tasks/delete/${id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    },
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return redirect("/routine-tasks");
}
