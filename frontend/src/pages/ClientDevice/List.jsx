import { useEffect } from "react";
import { redirect, useLocation } from "react-router";

import { BrowserView } from "react-device-detect";

import { getLocalStorageData } from "../../util/auth";

import { RiServerLine } from "react-icons/ri";

import List from "../../components/ClientDevice/List";
import ClientDeviceFilter from "../../components/ClientDevice/Filter";
import useClientDeviceFilterStore from "../../store/lists/client-devices";
import useSidebarStore from "../../store/sidebar";

import ListWrapper from "../../UI/ListWrapper";

const ClientDevices = () => {
  const location = useLocation();
  const filterStore = useClientDeviceFilterStore();
  const { setLeftSidebarContent } = useSidebarStore();

  useEffect(() => {
    filterStore.applyFilter();
  }, [filterStore.originalList]);

  useEffect(() => {
    filterStore.fetch();
  }, [location]);

  // Десктоп: фильтр в левый сайдбар (мобайл — через проп filter в ListWrapper)
  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <ClientDeviceFilter />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.originalList]);

  const title = () => {
    return (
      <>
        <RiServerLine /> Устройства
      </>
    );
  };

  return (
    <>
      <ListWrapper
        title={title}
        filter={<ClientDeviceFilter />}
        filterStore={filterStore}
        addRoute="/inventory/client-devices/add"
      >
        <List items={filterStore.filteredList}></List>
      </ListWrapper>
    </>
  );
};

export default ClientDevices;

export async function loader() {
  document.title = "Устройства";

  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/delete/${id}`,
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

  return redirect("/inventory/client-devices");
}
