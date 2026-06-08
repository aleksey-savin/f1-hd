import { useEffect } from "react";
import { useLocation } from "react-router";

import { FaNetworkWired } from "react-icons/fa";

import MikrotikDevicesList from "../../components/Devices/Mikrotik/List";

import ListWrapper from "../../UI/ListWrapper";

import useSidebarStore from "../../store/sidebar";

import { BrowserView } from "react-device-detect";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

const MikrotikDevices = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useMikrotikDeviceFilterStore();

  useEffect(() => {
    filterStore.applyFilter();
    filterStore.handleSorting(filterStore.sortBy);
  }, [filterStore.originalList]);

  useEffect(() => {
    filterStore.fetch();
  }, [location]);

  useEffect(() => {
    setLeftSidebarContent(<BrowserView></BrowserView>);
  }, [setLeftSidebarContent]);

  const title = () => {
    return (
      <>
        <FaNetworkWired /> Управление устройствами Mikrotik
      </>
    );
  };

  return (
    <>
      <ListWrapper
        title={title}
        filterStore={filterStore}
        showAddButton={false}
      >
        <MikrotikDevicesList
          items={filterStore.filteredList}
        ></MikrotikDevicesList>
      </ListWrapper>
    </>
  );
};

export default MikrotikDevices;

export async function loader() {
  document.title = "УПРАВЛЕНИЕ MIKROTIK";

  return null;
}
