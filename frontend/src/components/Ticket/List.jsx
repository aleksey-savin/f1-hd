import { useState, useEffect, useContext, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import AnimatedItem from "./AnimatedItem";
import BulkActionBar from "./BulkActionBar";

import { AuthedUserContext } from "../../store/authed-user-context";
import useTicketFilterStore from "../../store/lists/tickets";
import LiveUpdateIndicator from "../../UI/LiveUpdateIndicator";

const List = ({
  items = [],
  onDeleteSelected,
  onTakeToWorkSelected,
  onCommentSelected,
  onAddWorksSelected,
  onCloseSelected,
  onSelectionActiveChange,
}) => {
  const { permissions } = useContext(AuthedUserContext);
  const lastSyncedAt = useTicketFilterStore((state) => state.lastSyncedAt);
  const isLoading = useTicketFilterStore((state) => state.isLoading);
  const [selectedTickets, setSelectedTickets] = useState([]);
  // Пока массовое действие выполняется (запрос в полёте) — держим выделение и
  // показываем спиннер в панели, чтобы было видно, что данные обрабатываются.
  const [processing, setProcessing] = useState(false);

  // Выделять заявки могут как пользователи с правом удаления, так и исполнители
  // (для новых массовых действий — принять в работу / комментарий / работы /
  // закрыть). Каждая конкретная кнопка дополнительно гейтится своим правом.
  const canSelect =
    permissions.canDeleteTickets || permissions.canPerformTickets;

  // Сообщаем странице, активно ли выделение — пока что-то выбрано, фоновый опрос
  // ставится на паузу, чтобы список не переобновлялся под рукой.
  useEffect(() => {
    onSelectionActiveChange?.(selectedTickets.length > 0);
  }, [selectedTickets.length, onSelectionActiveChange]);

  // Стабильная ссылка (useCallback), чтобы memo(AnimatedItem) не перерисовывал
  // все карточки при каждом переключении выделения.
  const handleSelect = useCallback(
    (ticketId) => {
      if (!canSelect) return;
      setSelectedTickets((prev) =>
        prev.includes(ticketId)
          ? prev.filter((id) => id !== ticketId)
          : [...prev, ticketId],
      );
    },
    [canSelect],
  );

  const selectedItems = items.filter((item) =>
    selectedTickets.includes(item._id),
  );

  // Выполняем массовое действие текущим выделением: на время запроса показываем
  // спиннер (выделение держим), по завершении — сбрасываем выделение.
  const runAction = async (callback, payload) => {
    setProcessing(true);
    try {
      await callback(selectedTickets, payload);
    } finally {
      setProcessing(false);
      setSelectedTickets([]);
    }
  };

  return (
    <>
      <div className="d-flex justify-content-end mb-2">
        <LiveUpdateIndicator timestamp={lastSyncedAt} />
      </div>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <AnimatedItem
            key={item._id}
            item={item}
            isSelected={selectedTickets.includes(item._id)}
            onSelect={handleSelect}
          />
        ))}
      </AnimatePresence>

      <BulkActionBar
        selectedItems={selectedItems}
        isLoading={processing || isLoading}
        onTakeToWork={(payload) => runAction(onTakeToWorkSelected, payload)}
        onComment={(payload) => runAction(onCommentSelected, payload)}
        onAddWorks={(payload) => runAction(onAddWorksSelected, payload)}
        onClose={(payload) => runAction(onCloseSelected, payload)}
        onDelete={() => runAction(onDeleteSelected)}
        onReset={() => setSelectedTickets([])}
      />
    </>
  );
};

export default List;
