import { useEffect } from "react";
import { useLocation, redirect } from "react-router";

import useVendorFilterStore from "../../store/lists/vendors";

import List from "../../components/Vendor/List";

import ListWrapper from "../../UI/ListWrapper";
import { BrowserView } from "react-device-detect";
import VendorFilter from "../../components/Vendor/Filter";
import useSidebarStore from "../../store/sidebar";

import { HiOutlineBuildingOffice2 } from "react-icons/hi2";

import { getLocalStorageData } from "../../util/auth";

const VendorListPage = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useVendorFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  useEffect(() => {
    filterStore.fetch();
  }, [location]);

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <VendorFilter />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.originalList]);

  const title = () => {
    return (
      <>
        <HiOutlineBuildingOffice2 /> Вендоры
      </>
    );
  };
  return (
    <ListWrapper
      title={title}
      filterStore={filterStore}
      addRoute="/inventory/vendors/add"
    >
      <List items={filterStore.filteredList}></List>
    </ListWrapper>
  );
};

export default VendorListPage;

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/vendors/delete/${id}`,
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

  return redirect("/inventory/vendors");
}
