import { useState } from "react";

import {
  RiShieldCheckLine,
  RiDeleteBin6Line,
  RiInboxArchiveLine,
  RiCloseLine,
} from "react-icons/ri";

import BulkActionBar from "@/components/app/BulkActionBar";
import ConfirmDialog from "@/components/app/ConfirmDialog";

import VerifyModal from "./VerifyModal";
import useKnowledgeNotesStore from "../../store/lists/knowledgeNotes";
import useKnowledgeModerationStore from "../../store/knowledgeModeration";
import useToastStore from "../../store/toast-store";
import {
  verifyReason,
  confirmDeletionReason,
  declineDeletionReason,
  confirmArchiveReason,
  declineArchiveReason,
} from "../../util/knowledge-bulk-eligibility";

const API = import.meta.env.VITE_API_ADDRESS;

// Массовые действия над заметками в очередях модерации. Набор действий зависит
// от очереди: в «На проверку» проверяют, в «На удаление» — решают судьбу
// запросов. Один массив actions питает и десктопную панель, и мобильный остров
// (app/BulkActionBar).
const NoteBulkActionBar = () => {
  const { showToast } = useToastStore();
  const refreshCounts = useKnowledgeModerationStore((state) => state.refresh);

  const moderationMode = useKnowledgeNotesStore(
    (state) => state.moderationMode,
  );
  const selectedIds = useKnowledgeNotesStore((state) => state.selectedIds);
  const originalList = useKnowledgeNotesStore((state) => state.originalList);
  const clearSelection = useKnowledgeNotesStore(
    (state) => state.clearSelection,
  );
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
        reason: verifyReason(selectedItems),
      },
    ],
    "pending-deletion": [
      {
        key: "confirm-deletion",
        icon: RiDeleteBin6Line,
        label: "Удалить",
        danger: true,
        reason: confirmDeletionReason(selectedItems),
      },
      {
        key: "decline-deletion",
        icon: RiCloseLine,
        label: "Отклонить",
        reason: declineDeletionReason(selectedItems),
      },
    ],
    "pending-archive": [
      {
        key: "confirm-archive",
        icon: RiInboxArchiveLine,
        label: "В архив",
        reason: confirmArchiveReason(selectedItems),
      },
      {
        key: "decline-archive",
        icon: RiCloseLine,
        label: "Отклонить",
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

  if (actions.length === 0) {
    return null;
  }

  return (
    <>
      <VerifyModal
        open={openModal === "verify"}
        onOpenChange={(open) => !open && closeModal()}
        onConfirm={verifyHandler}
        isLoading={isProcessing}
        count={count}
      />

      <ConfirmDialog
        open={openModal === "confirm-deletion"}
        onOpenChange={(open) => !open && closeModal()}
        title="Подтверждение удаления"
        description={`Выбранные заметки (${count}) будут безвозвратно удалены из приложения. Это действие нельзя отменить.`}
        confirmLabel="Удалить безвозвратно"
        confirmVariant="destructive"
        isLoading={isProcessing}
        onConfirm={() => request("confirm-deletion-multiple")}
      />

      <ConfirmDialog
        open={openModal === "confirm-archive"}
        onOpenChange={(open) => !open && closeModal()}
        title="Подтверждение архивации"
        description={`Выбранные заметки (${count}) будут перемещены в архив и исчезнут из базы знаний. Они останутся доступны в наборе «Архив».`}
        confirmLabel="В архив"
        isLoading={isProcessing}
        onConfirm={() => request("confirm-archive-multiple")}
      />

      <BulkActionBar
        count={count}
        actions={actions}
        isLoading={isProcessing}
        onPick={pick}
        onClear={clearSelection}
        ariaLabel="Действия над выбранными заметками"
      />
    </>
  );
};

export default NoteBulkActionBar;
