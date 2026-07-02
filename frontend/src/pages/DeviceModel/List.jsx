import { useEffect } from "react";
import { useLocation, redirect } from "react-router";

import useDeviceModelFilterStore from "../../store/lists/deviceModels";

import List from "../../components/DeviceModel/List";

import ListWrapper from "../../UI/ListWrapper";
import { BrowserView } from "react-device-detect";
import DeviceModelFilter from "../../components/DeviceModel/Filter";
import useSidebarStore from "../../store/sidebar";

import { RiComputerLine } from "react-icons/ri";

import { getLocalStorageData } from "../../util/auth";

const DeviceModelListPage = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useDeviceModelFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  useEffect(() => {
    filterStore.fetch();
  }, [location]);

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <DeviceModelFilter />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.originalList]);

  const title = () => {
    return (
      <>
        <RiComputerLine /> Модели устройств
      </>
    );
  };
  return (
    <ListWrapper
      title={title}
      filterStore={filterStore}
      addRoute="/inventory/device-models/add"
    >
      <List items={filterStore.filteredList}></List>
    </ListWrapper>
  );
};

export default DeviceModelListPage;

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-models/delete/${id}`,
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

  return redirect("/inventory/device-models");
}
