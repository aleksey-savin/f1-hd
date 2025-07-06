import { useEffect } from "react";
import { useLocation } from "react-router";

import { BrowserView } from "react-device-detect";

import { RiBuilding2Line } from "react-icons/ri";

import List from "../../components/Company/List";
import CompanyFilter from "../../components/Company/Filter";

import ListWrapper from "../../UI/ListWrapper";

import useCompanyFilterStore from "../../store/lists/companies";
import useSidebarStore from "../../store/sidebar";

const Companies = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useCompanyFilterStore();

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
        <CompanyFilter />
      </BrowserView>
    );
  }, [setLeftSidebarContent, filterStore.originalList]);

  const title = () => {
    return (
      <>
        <RiBuilding2Line /> Компании
      </>
    );
  };

  return (
    <ListWrapper
      title={title}
      filter={<CompanyFilter />}
      filterStore={filterStore}
      addRoute="/companies/add"
    >
      <List items={filterStore.filteredList}></List>
    </ListWrapper>
  );
};

export default Companies;

export async function loader() {
  document.title = "КОМПАНИИ";

  return null;
}
