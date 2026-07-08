import { useEffect, useState } from "react";

import useSidebarStore from "../../store/sidebar";
import useTicketFilterStore from "../../store/lists/tickets";
import usePolling from "../../hooks/use-polling";

import { BrowserView, MobileView } from "react-device-detect";

import { TbCheckbox } from "react-icons/tb";

import ListWrapper from "../../UI/ListWrapper";

import TicketFilter from "../../components/Ticket/Filter";
import List from "../../components/Ticket/List";
import KnowledgeModerationCard from "../../components/KnowledgeBase/ModerationCard";
import ServiceExpiryCard from "../../components/KnowledgeBase/ServiceExpiryCard";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import { useLocation } from "react-router";
import useInitialPrefsStore from "../../store/prefs";
import useToastStore from "../../store/toast-store";

const Tickets = () => {
  const { modules } = useInitialPrefsStore();
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useTicketFilterStore();
  const { showToast } = useToastStore();

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

  // Общий запрос массового действия: POST на bulk-эндпоинт + обновление списка.
  // Сетевые сбои не роняем (см. память polling-fetch-error-handling) — показываем
  // тост, в любом случае перечитываем список.
  const bulkRequest = async (url, body, successMessage) => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}${url}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + localStorage.getItem("token"),
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error(`${url} ${response.status}`);
      showToast("success", successMessage);
    } catch (error) {
      console.error("Ошибка массового действия:", error);
      showToast("danger", "Не удалось выполнить действие. Попробуйте ещё раз.");
    } finally {
      // Тихое обновление (без isLoading-спиннера и пропадания списка) —
      // обновляем заявки на месте, выделение при этом сохраняется.
      await filterStore.silentRefresh();
    }
  };

  const handleDeleteSelected = (ids) =>
    bulkRequest("/api/tickets/delete-multiple", { ids }, "Заявки удалены");

  const handleTakeToWorkSelected = (ids, { takeOver }) =>
    bulkRequest(
      "/api/tickets/take-to-work-multiple",
      { ids, takeOver },
      "Заявки приняты в работу",
    );

  const handleCommentSelected = (ids, { content }) =>
    bulkRequest(
      "/api/comments/add-multiple",
      { ids, content },
      "Комментарий добавлен",
    );

  const handleAddWorksSelected = (ids, payload) =>
    bulkRequest(
      "/api/works/add",
      { ...payload, tickets: ids },
      "Работы добавлены",
    );

  const handleCloseSelected = (ids, { closingComment }) =>
    bulkRequest(
      "/api/tickets/close-multiple",
      { ids, closingComment },
      "Заявки закрыты",
    );

  // Мобайл: подсветка кнопки «Фильтр», когда в offcanvas выбрано что-то
  // помимо значений по умолчанию. Поиск и «Назначены на меня» не учитываем —
  // у них свои видимые индикаторы (раскрытый инпут и переключатель).
  const filterActive =
    filterStore.nowActive !== "all_active" ||
    filterStore.companies?.length > 0 ||
    filterStore.responsibles?.length > 0 ||
    filterStore.comments !== "any" ||
    filterStore.scheduledWorks !== "any" ||
    filterStore.routineTask !== "any";

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
      filterActive={filterActive}
      addRoute="/tickets/add"
      showRefreshButton={false}
      customData={customData}
      topContent={
        <>
          {modules.knowledgeBase.isActive && <KnowledgeModerationCard />}
          <ServiceExpiryCard />
        </>
      }
    >
      <List
        items={filterStore.filteredList}
        onDeleteSelected={handleDeleteSelected}
        onTakeToWorkSelected={handleTakeToWorkSelected}
        onCommentSelected={handleCommentSelected}
        onAddWorksSelected={handleAddWorksSelected}
        onCloseSelected={handleCloseSelected}
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
