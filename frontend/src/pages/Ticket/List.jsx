import { useEffect, useState } from "react";

import useSidebarStore from "../../store/sidebar";
import useTicketFilterStore from "../../store/lists/tickets";
import usePolling from "../../hooks/use-polling";

import { BrowserView, MobileView } from "react-device-detect";

import { TbCheckbox } from "react-icons/tb";

import ListWrapper from "../../UI/ListWrapper";

import TicketFilter from "../../components/Ticket/Filter";
import List from "../../components/Ticket/List";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import { useLocation } from "react-router";

const Tickets = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useTicketFilterStore();

  // Пока пользователь выделил заявки для удаления — фоновый опрос на паузе.
  const [selectionActive, setSelectionActive] = useState(false);

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
    filterStore.fetchOpened();
  }, [location]);

  useEffect(() => {
    if (filterStore.nowActive === "recently_closed") {
      filterStore.fetchRecentlyClosed();
    }
  }, [filterStore.nowActive]);

  // Постоянное фоновое автообновление списка: тихо подтягиваем свежие заявки
  // (новые, смена статуса, ИИ-бейджи) без спиннера и fade. Опрос на паузе, когда
  // вкладка скрыта или активно выделение заявок; при возврате фокуса — сразу.
  usePolling(() => filterStore.silentRefresh(), {
    intervalMs: 15000,
    enabled: !selectionActive,
  });

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <TicketFilter items={filterStore.originalList} />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.tickets]);

  const iAmResponsibleToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      iAmResponsible: !filterStore.iAmResponsible,
    });
    filterStore.applyFilter();
  };

  const title = () => {
    return (
      <>
        <TbCheckbox /> Заявки
      </>
    );
  };

  const handleDeleteSelected = async (selectedIds) => {
    try {
      await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/tickets/delete-multiple`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + localStorage.getItem("token"),
          },
          body: JSON.stringify({ ids: selectedIds }),
        },
      );

      // Refresh the list
      filterStore.fetchOpened();
    } catch (error) {
      console.error("Error deleting tickets:", error);
    }
  };

  const customData = () => {
    return (
      <MobileView>
        <Row className="my-3">
          <Col>
            <Form.Check
              type="switch"
              className="form-control-lg"
              id="i-am-responsible"
              label="Назначены на меня"
              value={filterStore.iAmResponsible}
              checked={filterStore.iAmResponsible}
              onChange={iAmResponsibleToggleHandler}
            />
          </Col>
        </Row>
      </MobileView>
    );
  };

  return (
    <ListWrapper
      title={title}
      filter={<TicketFilter />}
      filterStore={filterStore}
      addRoute="/tickets/add"
      customData={customData}
    >
      <List
        items={filterStore.filteredList}
        onDeleteSelected={handleDeleteSelected}
        onSelectionActiveChange={setSelectionActive}
      ></List>
    </ListWrapper>
  );
};

export default Tickets;

export async function loader() {
  document.title = "F1 HD | Заявки";
  return null;
}

export async function action() {
  return;
}
