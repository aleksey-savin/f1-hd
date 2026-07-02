import { useContext, useEffect, useState } from "react";
import { useLocation } from "react-router";

import { FaNetworkWired } from "react-icons/fa";

import MikrotikDevicesList from "../../components/Devices/Mikrotik/List";
import AddDeviceModal from "../../components/Devices/Mikrotik/AddDeviceModal";

import ListWrapper from "../../UI/ListWrapper";

import useSidebarStore from "../../store/sidebar";
import { AuthedUserContext } from "../../store/authed-user-context";

import { BrowserView } from "react-device-detect";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

const MikrotikDevices = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageMikrotikDevices;
  const filterStore = useMikrotikDeviceFilterStore();

  const [showAdd, setShowAdd] = useState(false);

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
        showAddButton={canManage}
        onAddClick={() => setShowAdd(true)}
      >
        <MikrotikDevicesList
          items={filterStore.filteredList}
        ></MikrotikDevicesList>
      </ListWrapper>
      <AddDeviceModal show={showAdd} onClose={() => setShowAdd(false)} />
    </>
  );
};

export default MikrotikDevices;

export async function loader() {
  document.title = "УПРАВЛЕНИЕ MIKROTIK";

  return null;
}
