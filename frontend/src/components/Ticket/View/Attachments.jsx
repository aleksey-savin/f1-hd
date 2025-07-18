import { useContext, useState, useEffect } from "react";
import { useDispatch } from "react-redux";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import AttachmentPreview from "../../UI/AttachmentPreview";
import AddAttachment from "./AddAttachment";
import { AuthedUserContext } from "../../../store/authed-user-context";
import useHttp from "../../../hooks/use-http";
import { getLocalStorageData } from "../../../util/auth";
import { toastActions } from "../../../store/toast";

const Attachments = ({ ticket }) => {
  const [attachments, setAttachments] = useState(ticket.attachments || []);
  const hasAttachments = attachments && attachments.length > 0;
  const { permissions } = useContext(AuthedUserContext);
  const { token } = getLocalStorageData();
  const { sendRequest } = useHttp();
  const dispatch = useDispatch();

  // Синхронизируем локальное состояние с props при изменении ticket
  useEffect(() => {
    setAttachments(ticket.attachments || []);
  }, [ticket.attachments]);

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
            setAttachments((prev) =>
              prev.filter((att) => att.name !== attachment.name),
            );
            // Показываем уведомление об успешном удалении
            dispatch(
              toastActions.showToast({
                type: "success",
                message: `Файл "${attachment.name}" удален`,
              }),
            );
          }
        },
      );
    } catch (error) {
      console.error("Error deleting attachment:", error);
      dispatch(
        toastActions.showToast({
          type: "error",
          message: "Ошибка при удалении файла",
        }),
      );
    }
  };

  const handleAttachmentAdded = (newAttachments) => {
    // Добавляем новые файлы к существующим
    setAttachments((prev) => [...prev, ...newAttachments]);
    // Показываем уведомление об успешном добавлении
    dispatch(
      toastActions.showToast({
        type: "success",
        message: `Добавлено файлов: ${newAttachments.length}`,
      }),
    );
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
