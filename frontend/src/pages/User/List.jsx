import { useEffect } from "react";
import { useLocation } from "react-router";
import { BrowserView } from "react-device-detect";

import useSidebarStore from "../../store/sidebar";
import useUserFilterStore from "../../store/lists/users";

import { RiAccountBoxLine } from "react-icons/ri";

import List from "../../components/User/List";

import ListWrapper from "../../UI/ListWrapper";

import UserFilter from "../../components/User/Filter";

const Users = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();

  const filterStore = useUserFilterStore();

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
        <UserFilter />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.originalList]);

  const title = () => {
    return (
      <>
        <RiAccountBoxLine /> Пользователи
      </>
    );
  };

  return (
    <ListWrapper
      title={title}
      filter={<UserFilter />}
      filterStore={filterStore}
      addRoute="/users/add"
    >
      <List items={filterStore.filteredList}></List>
    </ListWrapper>
  );
};

export default Users;

export async function loader() {
  document.title = "F1 HD | ПОЛЬЗОВАТЕЛИ";
  return null;
}
