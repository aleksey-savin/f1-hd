import { useState, useContext, useRef, useEffect } from "react";
import Button from "react-bootstrap/Button";
import Collapse from "react-bootstrap/Collapse";
import Alert from "react-bootstrap/Alert";
import FileUpload from "../../../UI/FileUpload";
import useHttp from "../../../hooks/use-http";
import { getLocalStorageData } from "../../../util/auth";
import { AuthedUserContext } from "../../../store/authed-user-context";

const AddAttachment = ({ ticket, onAttachmentAdded }) => {
  const [show, setShow] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const fileUploadRef = useRef();
  const { token } = getLocalStorageData();
  const { sendRequest } = useHttp();
  const { permissions } = useContext(AuthedUserContext);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (files.length === 0) {
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();

    for (const file of files) {
      formData.append("attachments", file);
    }

    try {
      await sendRequest(
        {
          url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticket.num}/add-attachments`,
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
          },
          isFormData: true,
          body: formData,
        },
        (data) => {
          if (data.success) {
            setFiles([]);
            setSuccess(true);
            // Очищаем FileUpload компонент
            if (fileUploadRef.current) {
              fileUploadRef.current.clearFiles();
            }
            if (onAttachmentAdded) {
              onAttachmentAdded(data.attachments);
            }
            // Состояние success будет обработано в useEffect
          } else {
            setError(data.message || "Ошибка при загрузке файлов");
          }
        },
      );
    } catch (error) {
      console.error("Error uploading attachments:", error);

      // Более детальная обработка ошибок
      let errorMessage = "Ошибка при загрузке файлов";

      if (error.message) {
        if (
          error.message.includes("NetworkError") ||
          error.message.includes("fetch")
        ) {
          errorMessage = "Ошибка сети. Проверьте подключение к интернету";
        } else if (
          error.message.includes("413") ||
          error.message.includes("Request Entity Too Large")
        ) {
          errorMessage = "Файлы слишком большие. Максимальный размер: 100MB";
        } else if (error.message.includes("400")) {
          errorMessage = "Неподдерживаемый формат файла";
        } else if (error.message.includes("RESULT_CODE_KILLED_BAD_MESSAGE")) {
          errorMessage =
            "Проблема с именем файла. Попробуйте переименовать файл (уберите спецсимволы)";
        } else {
          errorMessage = error.message;
        }
      }

      setError(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setFiles([]);
    setShow(false);
    setSuccess(false);
    setError(null);
  };

  // Автоматически скрываем алерт успеха через 5 секунд
  useEffect(() => {
    let timer;
    if (success) {
      timer = setTimeout(() => {
        setSuccess(false);
      }, 5000);
    }
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [success]);

  // Don't show for archived tickets or users without permissions
  if (ticket.isArchived || !permissions?.canAdministrateTickets) {
    return null;
  }

  return (
    <div className="my-2">
      <Button
        variant="outline-primary"
        size="md"
        onClick={() => setShow(!show)}
        disabled={uploading}
      >
        <i className="bi bi-plus-circle me-1"></i>
        Прикрепить файлы
      </Button>

      <Collapse in={show}>
        <div className="mt-2">
          <div className="border rounded p-3 bg-light">
            <form onSubmit={handleSubmit}>
              <FileUpload
                ref={fileUploadRef}
                setFiles={(newFiles) => {
                  setFiles(newFiles);
                  setError(null); // Clear errors when new files are selected
                }}
                files={files}
                showLabel={false}
                showText={true}
              />

              {success && (
                <Alert variant="success" className="mt-2 mb-2">
                  <i className="bi bi-check-circle me-1"></i>
                  Файлы успешно загружены!
                </Alert>
              )}

              {error && (
                <Alert
                  variant="danger"
                  className="mt-2 mb-2"
                  dismissible
                  onClose={() => setError(null)}
                >
                  <i className="bi bi-exclamation-triangle me-1"></i>
                  {error}
                </Alert>
              )}

              {files.length > 0 && !success && !error && (
                <div className="d-flex gap-2 mt-3">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={uploading || files.length === 0}
                  >
                    {uploading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-1" />
                        Загрузка...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-upload me-1"></i>
                        Загрузить ({files.length})
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline-secondary"
                    size="sm"
                    onClick={handleCancel}
                    disabled={uploading}
                  >
                    Отмена
                  </Button>
                </div>
              )}
            </form>
          </div>
        </div>
      </Collapse>
    </div>
  );
};

export default AddAttachment;
