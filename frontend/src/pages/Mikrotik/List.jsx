import { useContext, useEffect, useState } from "react";
import { useLocation } from "react-router";

import { RiRouterLine } from "react-icons/ri";

import MikrotikDevicesList from "../../components/Devices/Mikrotik/List";
import AddDeviceModal from "../../components/Devices/Mikrotik/AddDeviceModal";
import RouterOsReleasesStrip from "../../components/Devices/Mikrotik/RouterOsReleasesStrip";

import ListWrapper from "../../UI/ListWrapper";

import usePolling from "../../hooks/use-polling";
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
    // Тихое фоновое обновление уже пересчитало фильтр/сортировку атомарно —
    // не пересчитываем повторно, иначе мелькнёт спиннер и fade-анимация.
    if (filterStore.silentUpdate) {
      filterStore.clearSilentUpdate();
      return;
    }
    filterStore.applyFilter();
    filterStore.handleSorting(filterStore.sortBy);
  }, [filterStore.originalList]);

  useEffect(() => {
    filterStore.fetch();
  }, [location]);

  // Постоянное фоновое автообновление (как на странице заявок): статусы,
  // доступность и индикаторы прошивки подтягиваются без спиннера и fade;
  // опрос на паузе, пока вкладка скрыта, при возврате фокуса — сразу.
  usePolling(() => filterStore.silentRefresh(), { intervalMs: 15000 });

  useEffect(() => {
    setLeftSidebarContent(<BrowserView></BrowserView>);
  }, [setLeftSidebarContent]);

  const title = () => {
    return (
      <>
        <RiRouterLine /> Управление устройствами Mikrotik
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
        // Список сам обновляется фоновым опросом каждые 15 с — ручная кнопка не нужна.
        showRefreshButton={false}
        topContent={<RouterOsReleasesStrip />}
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
