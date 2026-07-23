import { useEffect } from "react";
import { redirect, useLocation } from "react-router";

import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import ListWrapper from "@/components/app/ListWrapper";

import List from "../../components/TicketTemplate/List";
import TicketTemplateFilter from "../../components/TicketTemplate/Filter";
import useTicketTemplateFilterStore from "../../store/lists/ticket-templates";
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

const TicketTemplates = () => {
  const location = useLocation();
  const filterStore = useTicketTemplateFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  // Фетчим только на самом списке: открытие шторки add/update — тоже навигация,
  // и рефетч в этот момент дёргал бы список под шторкой.
  useEffect(() => {
    if (location.pathname === "/ticket-templates") {
      filterStore.fetch();
    }
  }, [location.key]);

  const list = filterStore.originalList ?? [];

  const companyOptions = uniqueBy(
    list.flatMap((template) => template.sharedCompanies ?? []),
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
    list.map((template) => template.categoryId).find((c) => c?._id?.toString() === id)
      ?.title ?? id;

  const activeFilters = [
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
    (filterStore.sharedUsers ?? []).length > 0 && {
      key: "users",
      label: `Пользователи: ${filterStore.sharedUsers.length}`,
      onRemove: () => removeFilter({ sharedUsers: [] }),
    },
    (filterStore.authors ?? []).length > 0 && {
      key: "authors",
      label: `Авторы: ${filterStore.authors.length}`,
      onRemove: () => removeFilter({ authors: [] }),
    },
  ].filter(Boolean);

  return (
    <ListWrapper
      title={() => "Шаблоны заявок"}
      filterStore={filterStore}
      addRoute="/ticket-templates/add"
      addLabel="Новый шаблон"
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
      filter={<TicketTemplateFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
      formWide
    >
      <List items={filterStore.filteredList} />
    </ListWrapper>
  );
};

export default TicketTemplates;

export async function loader() {
  document.title = "Шаблоны заявок";
  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/delete/${id}`,
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

  return redirect("/ticket-templates");
}
