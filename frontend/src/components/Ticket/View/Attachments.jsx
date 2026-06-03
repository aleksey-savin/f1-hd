import { useContext, useState, useEffect } from "react";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import AttachmentPreview from "../../../UI/AttachmentPreview";
import AddAttachment from "./AddAttachment";
import { AuthedUserContext } from "../../../store/authed-user-context";
import useHttp from "../../../hooks/use-http";
import { getLocalStorageData } from "../../../util/auth";
import useToastStore from "../../../store/toast-store";
import useInitialPrefsStore from "../../../store/prefs";
import useViewTicketStore from "../../../store/view-ticket";

const Attachments = ({ ticket }) => {
  const [attachments, setAttachments] = useState(ticket.attachments || []);
  const [transcribingAttachmentName, setTranscribingAttachmentName] =
    useState("");
  const [openTranscriptionName, setOpenTranscriptionName] = useState("");
  const hasAttachments = attachments && attachments.length > 0;
  const { permissions } = useContext(AuthedUserContext);
  const { token } = getLocalStorageData();
  const { sendRequest } = useHttp();
  const { showToast } = useToastStore();
  const { ai } = useInitialPrefsStore();
  const ticketStore = useViewTicketStore();
  const canTranscribe =
    !ticket.isArchived &&
    permissions?.canPerformTickets &&
    ai?.speechToText?.isActive;

  // Синхронизируем локальное состояние с props при изменении ticket
  useEffect(() => {
    setAttachments(ticket.attachments || []);
    setOpenTranscriptionName("");
  }, [ticket.attachments]);

  const syncAttachments = (nextAttachments) => {
    setAttachments(nextAttachments);
    ticketStore.updateTicket({
      ...ticketStore.ticket,
      attachments: nextAttachments,
    });
  };

  const handleDeleteAttachment = async (attachment) => {
    try {
      await sendRequest(
        {
          url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticket.num}/remove-attachment`,
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: {
            attachmentName: attachment.name,
          },
        },
        (data) => {
          if (data.success) {
            // Обновляем локальное состояние вместо перезагрузки
            syncAttachments(
              attachments.filter((att) => att.name !== attachment.name),
            );
            // Показываем уведомление об успешном удалении
            showToast("success text-white", `Файл "${attachment.name}" удален`);
          }
        },
      );
    } catch (error) {
      console.error("Error deleting attachment:", error);
      showToast("danger text-white", "Ошибка при удалении файла");
    }
  };

  const handleAttachmentAdded = (newAttachments) => {
    // Добавляем новые файлы к существующим
    const nextAttachments = [...attachments, ...newAttachments];
    syncAttachments(nextAttachments);
    // Показываем уведомление об успешном добавлении
    showToast(
      "success text-white",
      `Добавлено файлов: ${newAttachments.length}`,
    );
  };

  const handleTranscribeAttachment = async (attachment) => {
    setTranscribingAttachmentName(attachment.name);

    const pendingAttachments = attachments.map((item) =>
      item.name === attachment.name
        ? {
            ...item,
            speechToText: {
              ...(item.speechToText || {}),
              status: "pending",
              error: "",
            },
          }
        : item,
    );
    syncAttachments(pendingAttachments);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticket.num}/attachments/speech-to-text`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ attachmentName: attachment.name }),
        },
      );
      const data = await response.json();

      if (data.attachments) {
        syncAttachments(data.attachments);
      }

      if (!response.ok || !data.success) {
        showToast(
          "danger text-white",
          data.message || "Не удалось распознать аудио",
        );
        return;
      }

      showToast("success text-white", "Аудио распознано");
      setOpenTranscriptionName(attachment.name);
    } catch (error) {
      console.error("Error recognizing speech:", error);
      const failedAttachments = pendingAttachments.map((item) =>
        item.name === attachment.name
          ? {
              ...item,
              speechToText: {
                ...(item.speechToText || {}),
                status: "error",
                error: "Не удалось распознать аудио",
              },
            }
          : item,
      );
      syncAttachments(failedAttachments);
      showToast("danger text-white", "Не удалось распознать аудио");
    } finally {
      setTranscribingAttachmentName("");
    }
  };

  return (
    <Row className="mb-2">
      <Col>
        {hasAttachments && (
          <AttachmentPreview
            attachments={attachments}
            compact={false}
            showAudioPlayer={true}
            canDelete={permissions?.canAdministrateTickets}
            onDelete={handleDeleteAttachment}
            canTranscribe={canTranscribe}
            onTranscribe={handleTranscribeAttachment}
            transcribingAttachmentName={transcribingAttachmentName}
            openTranscriptionName={openTranscriptionName}
          />
        )}
        <AddAttachment
          ticket={ticket}
          onAttachmentAdded={handleAttachmentAdded}
        />
      </Col>
    </Row>
  );
};

export default Attachments;
