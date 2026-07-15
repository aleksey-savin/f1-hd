import { useEffect } from "react";
import { redirect, useLocation } from "react-router";

import ListWrapper from "@/components/app/ListWrapper";

import { getLocalStorageData } from "../../util/auth";

import useTicketCategoryFilterStore from "../../store/lists/ticket-categories";

import List from "../../components/TicketCategory/List";
import TicketCategoryFilter from "../../components/TicketCategory/Filter";

const TicketCategories = () => {
  const location = useLocation();
  const filterStore = useTicketCategoryFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  // Фетчим только на самом списке: открытие/закрытие шторки add/update — тоже
  // навигация, и рефетч в этот момент дёргал бы список под шторкой (см. Vendors)
  useEffect(() => {
    if (location.pathname === "/ticket-categories") {
      filterStore.fetch();
    }
  }, [location.key]);

  const removeFilter = (patch) => {
    filterStore.updateFilter({ ...filterStore, ...patch });
    filterStore.applyFilter();
  };

  const selectedUsers = filterStore.users || [];
  const selectedPlans = filterStore.servicePlans || [];
  const activeFilters = [
    filterStore.isActive === true && {
      key: "isActive",
      label: "Только активные",
      onRemove: () => removeFilter({ isActive: false }),
    },
    filterStore.alwaysWithinPlan === true && {
      key: "alwaysWithinPlan",
      label: "Всегда в рамках тарифа",
      onRemove: () => removeFilter({ alwaysWithinPlan: false }),
    },
    ...selectedUsers.map((user) => ({
      key: `user-${user._id}`,
      label: `Пользователь: ${user.name}`,
      onRemove: () =>
        removeFilter({
          users: selectedUsers.filter((item) => item._id !== user._id),
        }),
    })),
    ...selectedPlans.map((plan) => ({
      key: `plan-${plan._id}`,
      label: `Услуга: ${plan.title}`,
      onRemove: () =>
        removeFilter({
          servicePlans: selectedPlans.filter((item) => item._id !== plan._id),
        }),
    })),
  ].filter(Boolean);

  return (
    <ListWrapper
      title={() => "Категории заявок"}
      filterStore={filterStore}
      addRoute="/ticket-categories/add"
      addLabel="Добавить категорию"
      filter={<TicketCategoryFilter />}
      filterActive={activeFilters.length > 0}
      activeFilters={activeFilters}
    >
      <List items={filterStore.filteredList} />
    </ListWrapper>
  );
};

export default TicketCategories;

export async function loader() {
  document.title = "КАТЕГОРИИ ЗАЯВОК";

  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/ticket-categories/delete/${id}`,
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

  return redirect("/ticket-categories");
}
