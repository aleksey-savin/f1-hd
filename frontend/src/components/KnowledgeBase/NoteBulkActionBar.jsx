import { useContext, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { isMobile } from "react-device-detect";

import Button from "react-bootstrap/Button";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";
import Spinner from "react-bootstrap/Spinner";

import {
  RiShieldCheckLine,
  RiDeleteBin6Line,
  RiInboxArchiveLine,
  RiCloseLine,
} from "react-icons/ri";

import MobileActionBar from "../../UI/MobileActionBar";
import ConfirmActionModal from "../../UI/ConfirmActionModal";
import VerifyModal from "./VerifyModal";

import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import useKnowledgeModerationStore from "../../store/knowledgeModeration";
import useToastStore from "../../store/toast-store";
import { ThemeContext } from "../../store/theme-context";
import { getLocalStorageData } from "../../util/auth";
import {
  verifyReason,
  confirmDeletionReason,
  declineDeletionReason,
  confirmArchiveReason,
  declineArchiveReason,
} from "../../util/knowledge-bulk-eligibility";

const API = import.meta.env.VITE_API_ADDRESS;

// Кнопка массового действия. Причина блокировки → кнопка disabled, а при
// наведении тултип объясняет почему. disabled-кнопка react-bootstrap не ловит
// hover, поэтому оборачиваем в span и гасим у кнопки pointer-events.
const ActionButton = ({ reason, busy, onClick, variant, icon: Icon, label }) => {
  const disabled = busy || !!reason;
  const button = (
    <Button
      size="sm"
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      style={disabled ? { pointerEvents: "none" } : undefined}
    >
      <Icon /> <span className="d-none d-sm-inline">{label}</span>
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

// Массовые действия над заметками в очередях модерации. Набор действий зависит
// от очереди: в «На проверку» проверяют, в «На удаление» — решают судьбу
// запросов. Один массив actions — источник правды и для десктопной панели, и
// для мобильного острова.
const NoteBulkActionBar = () => {
  const { token } = getLocalStorageData();
  const { isDark } = useContext(ThemeContext);
  const { showToast } = useToastStore();
  const refreshCounts = useKnowledgeModerationStore((state) => state.refresh);

  const moderationMode = useKnowledgeNotesStore((state) => state.moderationMode);
  const selectedIds = useKnowledgeNotesStore((state) => state.selectedIds);
  const originalList = useKnowledgeNotesStore((state) => state.originalList);
  const clearSelection = useKnowledgeNotesStore((state) => state.clearSelection);
  const fetchNotes = useKnowledgeNotesStore((state) => state.fetch);

  const [openModal, setOpenModal] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const selectedItems = originalList.filter((note) =>
    selectedIds.includes(note._id),
  );
  const count = selectedIds.length;

  const closeModal = () => setOpenModal(null);

  const request = async (path, body) => {
    setIsProcessing(true);
    try {
      const response = await fetch(`${API}/api/knowledge-notes/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ ids: selectedIds, ...body }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || "Не удалось выполнить действие");
      }
      showToast("success text-white", data.message);
      // Часть заметок могла не подойти — называем их поимённо, а не молча
      // пропускаем: иначе счётчик «Проверено: 4» из шести необъясним.
      if (data.skipped?.length) {
        showToast(
          "warning",
          `Пропущено: ${data.skipped
            .map((item) => `«${item.title}» (${item.reason})`)
            .join(", ")}`,
        );
      }
    } catch (error) {
      showToast("danger text-white", error.message);
    } finally {
      setIsProcessing(false);
      closeModal();
      // Список перечитываем в любом случае: часть заметок могла измениться до
      // ошибки, а выделение отсеется по факту присутствия в новом наборе.
      await fetchNotes();
      refreshCounts();
    }
  };

  const verifyHandler = ({ confirmCurrent, confirmNoSecrets }, reset) =>
    request("approve-multiple", { confirmCurrent, confirmNoSecrets }).then(() =>
      reset?.(),
    );

  // Действия очереди. Ключ совпадает с ключом openModal.
  const actionsByMode = {
    "all-unapproved": [
      {
        key: "verify",
        icon: RiShieldCheckLine,
        label: "Проверить",
        variant: "success",
        reason: verifyReason(selectedItems),
      },
    ],
    "pending-deletion": [
      {
        key: "confirm-deletion",
        icon: RiDeleteBin6Line,
        label: "Удалить",
        variant: "danger",
        danger: true,
        reason: confirmDeletionReason(selectedItems),
      },
      {
        key: "decline-deletion",
        icon: RiCloseLine,
        label: "Отклонить",
        variant: "outline-secondary",
        reason: declineDeletionReason(selectedItems),
      },
    ],
    "pending-archive": [
      {
        key: "confirm-archive",
        icon: RiInboxArchiveLine,
        label: "В архив",
        variant: "secondary",
        reason: confirmArchiveReason(selectedItems),
      },
      {
        key: "decline-archive",
        icon: RiCloseLine,
        label: "Отклонить",
        variant: "outline-secondary",
        reason: declineArchiveReason(selectedItems),
      },
    ],
  };

  const actions = actionsByMode[moderationMode] || [];

  const pick = (key) => {
    // Отклонение запроса ничего не разрушает — подтверждение не нужно.
    if (key === "decline-deletion") {
      return request("decline-deletion-multiple");
    }
    if (key === "decline-archive") {
      return request("decline-archive-multiple");
    }
    setOpenModal(key);
  };

  // Тема Darkly не выставляет data-bs-theme, а у панели свой инлайновый фон —
  // подстраиваем поверхность под тему вручную (как в Ticket/BulkActionBar).
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

  if (actions.length === 0) {
    return null;
  }

  return (
    <>
      <VerifyModal
        show={openModal === "verify"}
        onHide={closeModal}
        onConfirm={verifyHandler}
        isLoading={isProcessing}
        count={count}
      />

      <ConfirmActionModal
        show={openModal === "confirm-deletion"}
        onHide={closeModal}
        onConfirm={() => request("confirm-deletion-multiple")}
        title="Подтверждение удаления"
        body={`Выбранные заметки (${count}) будут безвозвратно удалены из приложения. Это действие нельзя отменить.`}
        confirmLabel="Удалить безвозвратно"
        confirmVariant="danger"
        isLoading={isProcessing}
      />

      <ConfirmActionModal
        show={openModal === "confirm-archive"}
        onHide={closeModal}
        onConfirm={() => request("confirm-archive-multiple")}
        title="Подтверждение архивации"
        body={`Выбранные заметки (${count}) будут перемещены в архив и исчезнут из базы знаний. Они останутся доступны в наборе «Архив».`}
        confirmLabel="В архив"
        confirmVariant="secondary"
        isLoading={isProcessing}
      />

      {isMobile ? (
        <MobileActionBar
          show={count > 0}
          statusText={`Выбрано: ${count}`}
          actions={actions}
          isLoading={isProcessing}
          onPick={pick}
          onCancel={clearSelection}
          ariaLabel="Действия над выбранными заметками"
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
                {isProcessing && (
                  <Spinner
                    animation="border"
                    size="sm"
                    className="ms-2"
                    role="status"
                    aria-label="Обновление данных"
                  />
                )}
              </span>

              {actions.map((action) => (
                <ActionButton
                  key={action.key}
                  variant={action.variant}
                  busy={isProcessing}
                  reason={action.reason}
                  onClick={() => pick(action.key)}
                  icon={action.icon}
                  label={action.label}
                />
              ))}

              <Button
                size="sm"
                variant="secondary"
                className="mx-1"
                onClick={clearSelection}
                disabled={isProcessing}
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

export default NoteBulkActionBar;
