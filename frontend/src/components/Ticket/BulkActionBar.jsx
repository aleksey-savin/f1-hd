import { useContext, useState } from "react";

import {
  RiChat3Line,
  RiCheckboxCircleLine,
  RiDeleteBinLine,
  RiPlayCircleLine,
  RiToolsLine,
} from "react-icons/ri";

import BulkActionBarBase from "@/components/app/BulkActionBar";
import ConfirmDialog from "@/components/app/ConfirmDialog";

import { AuthedUserContext } from "../../store/authed-user-context";
import {
  addWorksReason,
  closeReason,
  commentReason,
  takeToWorkReason,
} from "../../util/ticket-bulk-eligibility";

import AddWorksSheet from "./BulkActions/AddWorksSheet";
import CloseModal from "./BulkActions/CloseModal";
import CommentModal from "./BulkActions/CommentModal";
import TakeToWorkModal from "./BulkActions/TakeToWorkModal";

// Действия над выбранными заявками. Панель показывается всё время, пока включён
// режим выбора (а не только когда что-то выбрано): человек вошёл в режим
// осознанно и должен видеть, что ему доступно. С нулём выбранных действия
// приглушены и объясняют причину — как и любое заблокированное действие панели.
//
// Управление самим выбором («Выбрать все», «Отмена») живёт в app/SelectionBar,
// поэтому `onClear` тут не передаём: два выхода читались бы как два разных.
const TicketBulkActionBar = ({
  selectionActive,
  selectedItems,
  isLoading,
  onTakeToWork,
  onComment,
  onAddWorks,
  onClose,
  onDelete,
}) => {
  const { _id: userId, permissions } = useContext(AuthedUserContext);
  const [openModal, setOpenModal] = useState(null);

  const count = selectedItems.length;
  const context = { userId, permissions };
  const closeModal = () => setOpenModal(null);

  const empty = count === 0 ? "Выберите заявки" : null;

  const actions = [
    permissions.canPerformTickets && {
      key: "takeToWork",
      icon: RiPlayCircleLine,
      label: "В работу",
      reason: empty ?? takeToWorkReason(selectedItems, context),
    },
    permissions.canPerformTickets && {
      key: "comment",
      icon: RiChat3Line,
      label: "Комментарий",
      reason: empty ?? commentReason(selectedItems),
    },
    permissions.canPerformTickets &&
      permissions.canUseTimeTrackingModule && {
        key: "works",
        icon: RiToolsLine,
        label: "Работы",
        reason: empty ?? addWorksReason(selectedItems),
      },
    permissions.canPerformTickets && {
      key: "close",
      icon: RiCheckboxCircleLine,
      label: "Закрыть",
      reason: empty ?? closeReason(selectedItems, context),
    },
    permissions.canDeleteTickets && {
      key: "delete",
      icon: RiDeleteBinLine,
      label: "Удалить",
      reason: empty,
      danger: true,
    },
  ].filter(Boolean);

  return (
    <>
      <TakeToWorkModal
        show={openModal === "takeToWork"}
        onHide={closeModal}
        count={count}
        onConfirm={onTakeToWork}
      />
      <CommentModal
        show={openModal === "comment"}
        onHide={closeModal}
        count={count}
        onConfirm={onComment}
      />
      <AddWorksSheet
        show={openModal === "works"}
        onHide={closeModal}
        selectedItems={selectedItems}
        onConfirm={onAddWorks}
      />
      <CloseModal
        show={openModal === "close"}
        onHide={closeModal}
        count={count}
        onConfirm={onClose}
      />
      <ConfirmDialog
        open={openModal === "delete"}
        onOpenChange={(open) => !open && closeModal()}
        title={`Удалить заявки (${count})`}
        description="Вы уверены? Это действие нельзя отменить."
        confirmLabel="Удалить"
        confirmVariant="destructive"
        confirmIcon={<RiDeleteBinLine />}
        onConfirm={() => {
          closeModal();
          onDelete();
        }}
      />

      <BulkActionBarBase
        count={count}
        show={selectionActive}
        actions={actions}
        isLoading={isLoading}
        onPick={setOpenModal}
        statusText={count > 0 ? `Выбрано: ${count}` : "Ничего не выбрано"}
        ariaLabel="Действия над выбранными заявками"
      />
    </>
  );
};

export default TicketBulkActionBar;
