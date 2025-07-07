import { useEffect } from "react";
import { redirect, useLocation } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import useTicketCategoryFilterStore from "../../store/lists/ticket-categories";

import { RiServerLine } from "react-icons/ri";

import List from "../../components/TicketCategory/List";

import ListWrapper from "../../UI/ListWrapper";
import { BrowserView } from "react-device-detect";
import TicketCategoryFilter from "../../components/TicketCategory/Filter";
import useSidebarStore from "../../store/sidebar";

const TicketCategories = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useTicketCategoryFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  useEffect(() => {
    filterStore.fetch();
  }, [location]);

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <TicketCategoryFilter />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.originalList]);

  const title = () => {
    return (
      <>
        <RiServerLine /> Категории заявок
      </>
    );
  };

  return (
    <ListWrapper
      title={title}
      filterStore={filterStore}
      addRoute="/ticket-categories/add"
    >
      <List items={filterStore.filteredList}></List>
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
