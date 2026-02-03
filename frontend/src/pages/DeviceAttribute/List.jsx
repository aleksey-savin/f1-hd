import { useEffect } from "react";
import { useLocation, redirect } from "react-router";

import useDeviceAttributeFilterStore from "../../store/lists/deviceAttributes";

import List from "../../components/DeviceAttribute/List";

import ListWrapper from "../../UI/ListWrapper";
import { BrowserView } from "react-device-detect";
import DeviceAttributeFilter from "../../components/DeviceAttribute/Filter";
import useSidebarStore from "../../store/sidebar";

import { MdOutlineFormatListBulleted } from "react-icons/md";

import { getLocalStorageData } from "../../util/auth";

const DeviceAttributeListPage = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useDeviceAttributeFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  useEffect(() => {
    filterStore.fetch();
  }, [location]);

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <DeviceAttributeFilter />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.originalList]);

  const title = () => {
    return (
      <>
        <MdOutlineFormatListBulleted /> Атрибуты устройств
      </>
    );
  };
  return (
    <ListWrapper
      title={title}
      filterStore={filterStore}
      addRoute="/inventory/device-attributes/add"
    >
      <List items={filterStore.filteredList}></List>
    </ListWrapper>
  );
};

export default DeviceAttributeListPage;

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-attributes/delete/${id}`,
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

  return redirect("/inventory/device-attributes");
}
