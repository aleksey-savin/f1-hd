import { useEffect } from "react";
import { redirect, useLocation } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import { GoProjectTemplate } from "react-icons/go";

import List from "../../components/TicketTemplate/List";

import ListWrapper from "../../UI/ListWrapper";
import useTicketTemplateFilterStore from "../../store/lists/ticket-templates";
import useSidebarStore from "../../store/sidebar";
import { BrowserView } from "react-device-detect";
import TicketTemplateFilter from "../../components/TicketTemplate/Filter";

const TicketTemplates = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useTicketTemplateFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
    filterStore.handleSorting(filterStore.sortBy);
  }, [filterStore.originalList]);

  useEffect(() => {
    filterStore.fetch();
  }, [location]);

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <TicketTemplateFilter />
      </BrowserView>
    );
  }, [setLeftSidebarContent]);

  const title = () => {
    return (
      <>
        <GoProjectTemplate /> Шаблоны заявок
      </>
    );
  };

  return (
    <ListWrapper
      title={title}
      filter={<TicketTemplateFilter />}
      filterStore={filterStore}
      addRoute="/ticket-templates/add"
      hiddenAddButton
    >
      <List items={filterStore.filteredList}></List>
    </ListWrapper>
  );
};

export default TicketTemplates;

export async function loader() {
  document.title = "ШАБЛОНЫ ЗАЯВОК";
  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/ticket-templates/delete/${id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    }
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return redirect("/ticket-templates");
}
