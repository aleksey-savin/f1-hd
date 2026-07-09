import { useContext, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { isMobile } from "react-device-detect";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";
import Spinner from "react-bootstrap/Spinner";

import {
  RiPlayCircleLine,
  RiChat3Line,
  RiToolsLine,
  RiCheckboxCircleLine,
  RiDeleteBinLine,
  RiCloseLine,
} from "react-icons/ri";

import { AuthedUserContext } from "../../store/authed-user-context";
import { ThemeContext } from "../../store/theme-context";

import MobileActionBar from "../../UI/MobileActionBar";

import TakeToWorkModal from "./BulkActions/TakeToWorkModal";
import CommentModal from "./BulkActions/CommentModal";
import CloseModal from "./BulkActions/CloseModal";
import AddWorksModal from "./BulkActions/AddWorksModal";

import {
  takeToWorkReason,
  commentReason,
  addWorksReason,
  closeReason,
} from "../../util/ticket-bulk-eligibility";

// Кнопка массового действия. Если есть причина блокировки — кнопка disabled, а
// при наведении тултип объясняет почему. disabled-кнопка react-bootstrap не ловит
// hover, поэтому оборачиваем во span (он и держит отступ), а у самой кнопки гасим
// pointer-events.
const ActionButton = ({ reason, busy, onClick, variant, icon, label }) => {
  const disabled = busy || !!reason;
  const button = (
    <Button
      size="sm"
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      style={disabled ? { pointerEvents: "none" } : undefined}
    >
      {icon} <span className="d-none d-sm-inline">{label}</span>
    </Button>
  );

  if (!reason) {
    return <span className="d-inline-block mx-1">{button}</span>;
  }

  return (
    <OverlayTrigger overlay={<Tooltip>{reason}</Tooltip>}>
      <span className="d-inline-block mx-1" tabIndex={0}>
        {button}
      </span>
    </OverlayTrigger>
  );
};

const BulkActionBar = ({
  selectedItems,
  isLoading,
  onTakeToWork,
  onComment,
  onAddWorks,
  onClose,
  onDelete,
  onReset,
}) => {
  const { _id: userId, permissions } = useContext(AuthedUserContext);
  const { isDark } = useContext(ThemeContext);
  const [openModal, setOpenModal] = useState(null);

  const count = selectedItems.length;
  const ctx = { userId, permissions };

  const closeModal = () => setOpenModal(null);

  // Единый источник правды для десктопной панели и мобильной: подпись, иконка,
  // модалка и причина блокировки описаны по одному разу. key совпадает с ключом
  // openModal.
  const actions = [
    permissions.canPerformTickets && {
      key: "takeToWork",
      icon: RiPlayCircleLine,
      label: "В работу",
      variant: "success",
      reason: takeToWorkReason(selectedItems, ctx),
    },
    permissions.canPerformTickets && {
      key: "comment",
      icon: RiChat3Line,
      label: "Комментарий",
      variant: "primary",
      reason: commentReason(selectedItems),
    },
    permissions.canPerformTickets && {
      key: "works",
      icon: RiToolsLine,
      label: "Работы",
      variant: "primary",
      reason: addWorksReason(selectedItems),
    },
    permissions.canPerformTickets && {
      key: "close",
      icon: RiCheckboxCircleLine,
      label: "Закрыть",
      variant: "success",
      reason: closeReason(selectedItems, ctx),
    },
    permissions.canDeleteTickets && {
      key: "delete",
      icon: RiDeleteBinLine,
      label: "Удалить",
      variant: "danger",
      reason: null,
      danger: true,
    },
  ].filter(Boolean);

  // Тема Darkly не выставляет data-bs-theme, а у панели свой инлайновый фон —
  // поэтому подстраиваем поверхность под тему вручную (как UI/Select).
  const surface = isDark
    ? {
        background: "#303030",
        color: "#dee2e6",
        boxShadow: "0 2px 16px rgba(0, 0, 0, 0.7)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
      }
    : {
        background: "#ffffff",
        color: "#212529",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.15)",
        border: "1px solid rgba(0, 0, 0, 0.08)",
      };

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
      <AddWorksModal
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

      <Modal show={openModal === "delete"} centered onHide={closeModal}>
        <Modal.Header closeButton>
          <Modal.Title>Подтверждение удаления</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Вы уверены, что хотите удалить выбранные заявки?
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={closeModal}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              closeModal();
              onDelete();
            }}
          >
            <RiDeleteBinLine /> Удалить
          </Button>
        </Modal.Footer>
      </Modal>

      {isMobile ? (
        <MobileActionBar
          show={count > 0}
          statusText={`Выбрано: ${count}`}
          actions={actions}
          isLoading={isLoading}
          onPick={setOpenModal}
          onCancel={onReset}
          ariaLabel="Действия над выбранными заявками"
        />
      ) : (
        <AnimatePresence>
          {count > 0 && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: "spring", duration: 0.3 }}
              style={{
                position: "fixed",
                bottom: "1rem",
                left: 0,
                right: 0,
                padding: "0.5rem 1rem",
                zIndex: 1100,
                borderRadius: "8px",
                width: "fit-content",
                maxWidth: "95%",
                margin: "0 auto",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.25rem",
                ...surface,
              }}
            >
              <span className="me-2 fw-semibold text-nowrap">
                Выбрано: {count}
                {isLoading && (
                  <Spinner
                    animation="border"
                    size="sm"
                    className="ms-2"
                    role="status"
                    aria-label="Обновление данных"
                  />
                )}
              </span>

              {actions.map(({ key, icon: Icon, label, variant, reason }) => (
                <ActionButton
                  key={key}
                  variant={variant}
                  busy={isLoading}
                  reason={reason}
                  onClick={() => setOpenModal(key)}
                  icon={<Icon />}
                  label={label}
                />
              ))}

              <Button
                size="sm"
                variant="secondary"
                className="mx-1"
                onClick={onReset}
                disabled={isLoading}
              >
                <RiCloseLine />{" "}
                <span className="d-none d-sm-inline">Сбросить</span>
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  );
};

export default BulkActionBar;
