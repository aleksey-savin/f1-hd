import { useEffect } from "react";
import { redirect, useLocation } from "react-router";

import RoutineTaskFilter from "../../components/RoutineTask/Filter";

import { RiCalendar2Line } from "react-icons/ri";
import ListWrapper from "../../UI/ListWrapper";

import List from "../../components/RoutineTask/List";

import { getLocalStorageData } from "../../util/auth";

import useRoutineTaskFilterStore from "../../store/lists/routine-tasks";
import useSidebarStore from "../../store/sidebar";
import { BrowserView } from "react-device-detect";

const RoutineTasks = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();

  const filterStore = useRoutineTaskFilterStore();

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
        <RoutineTaskFilter />
      </BrowserView>,
    );
  }, [setLeftSidebarContent]);

  const title = () => {
    return (
      <>
        <RiCalendar2Line /> Регламентные задания
      </>
    );
  };

  return (
    <ListWrapper
      title={title}
      filter={<RoutineTaskFilter />}
      filterStore={filterStore}
      addRoute="/routine-tasks/add"
    >
      <List items={filterStore.filteredList}></List>
    </ListWrapper>
  );
};

export default RoutineTasks;

export async function loader() {
  document.title = "РЕГЛАМЕНТНЫЕ ЗАДАНИЯ";

  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/routine-tasks/delete/${id}`,
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
