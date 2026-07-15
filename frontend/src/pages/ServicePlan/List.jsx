import { useEffect } from "react";
import { redirect, useLocation } from "react-router";

import ListWrapper from "@/components/app/ListWrapper";

import { getLocalStorageData } from "../../util/auth";

import List from "../../components/ServicePlan/List";
import ServicePlanFilter from "../../components/ServicePlan/Filter";
import { tariffTypeName } from "../../components/ServicePlan/tariff-types";

import useServicePlanFilterStore from "../../store/lists/service-plans";

const ServicePlans = () => {
  const location = useLocation();
  const filterStore = useServicePlanFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  // Фетчим только на самом списке: открытие карточки/шторки — тоже навигация
  useEffect(() => {
    if (location.pathname === "/finances/service-plans") {
      filterStore.fetch();
    }
  }, [location.key]);

  const removeFilter = (patch) => {
    filterStore.updateFilter({ ...filterStore, ...patch });
    filterStore.applyFilter();
  };

  const selectedCompanies = filterStore.companies || [];
  const selectedCategories = filterStore.ticketCategories || [];
  const activeFilters = [
    filterStore.type &&
      filterStore.type !== "any" && {
        key: "type",
        label: `Тип: ${tariffTypeName(filterStore.type)}`,
        onRemove: () => removeFilter({ type: "any" }),
      },
    ...selectedCompanies.map((company) => ({
      key: `company-${company._id}`,
      label: `Компания: ${company.alias}`,
      onRemove: () =>
        removeFilter({
          companies: selectedCompanies.filter(
            (item) => item._id !== company._id,
          ),
        }),
    })),
    ...selectedCategories.map((category) => ({
      key: `category-${category._id}`,
      label: `Категория: ${category.title}`,
      onRemove: () =>
        removeFilter({
          ticketCategories: selectedCategories.filter(
            (item) => item._id !== category._id,
          ),
        }),
    })),
  ].filter(Boolean);

  return (
    <ListWrapper
      title={() => "Услуги"}
      filterStore={filterStore}
      addRoute="/finances/service-plans/add"
      addLabel="Добавить услугу"
      filter={<ServicePlanFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
    >
      <List items={filterStore.filteredList} />
    </ListWrapper>
  );
};

export default ServicePlans;

export async function loader() {
  document.title = "УСЛУГИ";

  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const intent = data.get("intent");
  const id = data.get("id");

  if (intent === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/service-plans/delete/${id}`,
      {
        method: "DELETE",
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

    return redirect("/finances/service-plans");
  }
}
