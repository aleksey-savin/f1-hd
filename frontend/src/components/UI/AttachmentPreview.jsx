import { useState } from "react";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Image from "react-bootstrap/Image";
import Modal from "react-bootstrap/Modal";
import Spinner from "react-bootstrap/Spinner";
import Alert from "react-bootstrap/Alert";
import AudioPlayer from "react-h5-audio-player";

const AttachmentPreview = ({
  attachments,
  compact = false,
  showAudioPlayer = true,
  canDelete = false,
  onDelete = null,
}) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fileToDelete, setFileToDelete] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const getFileExtension = (filename) => {
    return filename.split(".").pop().toLowerCase();
  };

  const getFileIcon = (filename) => {
    const extension = getFileExtension(filename);
    const iconMap = {
      jpg: "bi-image",
      jpeg: "bi-image",
      png: "bi-image",
      gif: "bi-image",
      bmp: "bi-image",
      webp: "bi-image",
      svg: "bi-image",
      pdf: "bi-file-earmark-pdf",
      doc: "bi-file-word",
      docx: "bi-file-word",
      xls: "bi-file-excel",
      xlsx: "bi-file-excel",
      ppt: "bi-file-ppt",
      pptx: "bi-file-ppt",
      txt: "bi-file-text",
      log: "bi-file-text",
      csv: "bi-file-text",
      json: "bi-file-code",
      xml: "bi-file-code",
      md: "bi-file-text",
      mp3: "bi-music-note",
      wav: "bi-music-note",
      ogg: "bi-music-note",
      aac: "bi-music-note",
      flac: "bi-music-note",
      mp4: "bi-play-circle",
      webm: "bi-play-circle",
      avi: "bi-play-circle",
      mov: "bi-play-circle",
      wmv: "bi-play-circle",
      flv: "bi-play-circle",
      zip: "bi-file-zip",
      rar: "bi-file-zip",
      "7z": "bi-file-zip",
      tar: "bi-file-zip",
      gz: "bi-file-zip",
    };
    return iconMap[extension] || "bi-file-earmark";
  };

  const isImage = (filename) => {
    const imageExtensions = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"];
    return imageExtensions.includes(getFileExtension(filename));
  };

  const isAudio = (filename) => {
    const audioExtensions = ["mp3", "wav", "ogg", "aac", "flac"];
    return audioExtensions.includes(getFileExtension(filename));
  };

  const isVideo = (filename) => {
    const videoExtensions = ["mp4", "webm", "ogg", "avi", "mov", "wmv", "flv"];
    return videoExtensions.includes(getFileExtension(filename));
  };

  const isPDF = (filename) => {
    return getFileExtension(filename) === "pdf";
  };

  const isText = (filename) => {
    const textExtensions = ["txt", "log", "csv", "json", "xml", "md"];
    return textExtensions.includes(getFileExtension(filename));
  };

  const isPreviewable = (filename) => {
    return (
      isImage(filename) ||
      isPDF(filename) ||
      isVideo(filename) ||
      isAudio(filename) ||
      isText(filename)
    );
  };

  const handlePreview = (attachment) => {
    setSelectedFile(attachment);
    setShowPreview(true);
    setLoading(true);
    setError(false);
  };

  const handleClosePreview = () => {
    setShowPreview(false);
    setSelectedFile(null);
    setLoading(true);
    setError(false);
  };

  const renderFilePreview = () => {
    if (!selectedFile) return null;
    const fileUrl = `${import.meta.env.VITE_API_ADDRESS}/uploads/${selectedFile.name}`;

    if (isImage(selectedFile.name)) {
      return (
        <div className="text-center">
          {loading && <Spinner animation="border" variant="primary" />}
          <Image
            src={fileUrl}
            fluid
            style={{ maxHeight: "70vh", maxWidth: "100%" }}
            className={loading ? "d-none" : ""}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
          />
          {error && <Alert variant="danger">Ошибка загрузки изображения</Alert>}
        </div>
      );
    }

    if (isPDF(selectedFile.name)) {
      return (
        <div className="position-relative" style={{ height: "70vh" }}>
          {loading && (
            <div className="position-absolute top-50 start-50 translate-middle">
              <Spinner animation="border" variant="primary" />
            </div>
          )}
          <iframe
            src={fileUrl}
            width="100%"
            height="100%"
            title={selectedFile.name}
            className="border rounded"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
          />
          {error && (
            <Alert variant="danger">
              Ошибка загрузки PDF.{" "}
              <a href={fileUrl} target="_blank" rel="noreferrer">
                Открыть в новой вкладке
              </a>
            </Alert>
          )}
        </div>
      );
    }

    if (isVideo(selectedFile.name)) {
      return (
        <div className="text-center">
          <video
            controls
            style={{ maxHeight: "70vh", maxWidth: "100%" }}
            className="rounded"
            onLoadStart={() => setLoading(false)}
            onError={() => setError(true)}
          >
            <source src={fileUrl} />
            Ваш браузер не поддерживает воспроизведение видео.
          </video>
          {error && <Alert variant="danger">Ошибка загрузки видео</Alert>}
        </div>
      );
    }

    if (isAudio(selectedFile.name)) {
      return (
        <div className="text-center">
          <audio
            controls
            style={{ width: "100%" }}
            className="rounded"
            onLoadStart={() => setLoading(false)}
            onError={() => setError(true)}
          >
            <source src={fileUrl} />
            Ваш браузер не поддерживает воспроизведение аудио.
          </audio>
          {error && <Alert variant="danger">Ошибка загрузки аудио</Alert>}
        </div>
      );
    }

    if (isText(selectedFile.name)) {
      return (
        <div className="position-relative">
          {loading && (
            <div className="position-absolute top-50 start-50 translate-middle">
              <Spinner animation="border" variant="primary" />
            </div>
          )}
          <iframe
            src={fileUrl}
            width="100%"
            height="400px"
            title={selectedFile.name}
            className="border rounded"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
          />
          {error && (
            <Alert variant="danger">
              Ошибка загрузки файла.{" "}
              <a href={fileUrl} target="_blank" rel="noreferrer">
                Открыть в новой вкладке
              </a>
            </Alert>
          )}
        </div>
      );
    }

    return (
      <div className="text-center p-4">
        <i className="bi bi-file-earmark display-1 text-muted"></i>
        <h5 className="mt-3">{selectedFile.name}</h5>
        <p className="text-muted">
          Предпросмотр недоступен для данного типа файла
        </p>
        <Button
          variant="primary"
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
        >
          Скачать файл
        </Button>
      </div>
    );
  };

  const handleDelete = (attachment) => {
    setFileToDelete(attachment);
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (onDelete && fileToDelete) {
      onDelete(fileToDelete);
    }
    setShowDeleteModal(false);
    setFileToDelete(null);
  };

  const cancelDelete = () => {
    setShowDeleteModal(false);
    setFileToDelete(null);
  };

  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <>
      {/* Очень компактное отображение */}
      <div className={compact ? "mt-2" : "mt-3"}>
        {!compact && (
          <small className="text-muted fw-bold d-block mb-2">
            <i className="bi bi-paperclip me-1"></i>
            Файлы ({attachments.length})
          </small>
        )}

        <div className="d-flex flex-wrap gap-1">
          {attachments.map((attachment) => {
            const extension = getFileExtension(attachment.name);
            const fileUrl = `${import.meta.env.VITE_API_ADDRESS}/uploads/${attachment.name}`;

            // Для аудио файлов показываем мини-плеер
            if (isAudio(attachment.name) && showAudioPlayer) {
              return (
                <div key={attachment.name} className="w-100 mb-2">
                  <div
                    className="p-2 bg-light rounded border"
                    style={{ fontSize: "0.85rem" }}
                  >
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <small className="text-muted">
                        <i className="bi bi-music-note me-1"></i>
                        {attachment.name}
                      </small>
                      <div className="d-flex gap-1">
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          className="py-0 px-1"
                          href={fileUrl}
                          target="_blank"
                          style={{ fontSize: "0.7rem" }}
                        >
                          <i className="bi bi-download"></i>
                        </Button>
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="outline-danger"
                            className="py-0 px-1"
                            onClick={() => handleDelete(attachment)}
                            style={{ fontSize: "0.7rem" }}
                          >
                            <i className="bi bi-trash"></i>
                          </Button>
                        )}
                      </div>
                    </div>
                    <AudioPlayer
                      src={fileUrl}
                      showJumpControls={false}
                      layout="horizontal"
                      customProgressBarSection={[
                        "CURRENT_TIME",
                        "PROGRESS_BAR",
                        "DURATION",
                      ]}
                      customControlsSection={["MAIN_CONTROLS"]}
                      style={{ fontSize: "0.8rem" }}
                    />
                  </div>
                </div>
              );
            }

            // Для всех файлов - только иконки
            return (
              <div
                key={attachment.name}
                className="d-inline-flex align-items-center p-1 me-2 mb-1 bg-light rounded border"
                style={{ fontSize: "0.85rem" }}
              >
                <i
                  className={`${getFileIcon(attachment.name)} text-primary me-2`}
                  style={{ fontSize: "1.2rem" }}
                ></i>

                <div className="me-2">
                  <div
                    className="text-truncate fw-medium"
                    title={attachment.name}
                    style={{ fontSize: "0.8rem", maxWidth: "150px" }}
                  >
                    {attachment.name}
                  </div>
                  <Badge bg="secondary" style={{ fontSize: "0.6rem" }}>
                    {extension.toUpperCase()}
                  </Badge>
                </div>

                <div className="d-flex gap-1">
                  {isPreviewable(attachment.name) && (
                    <Button
                      size="sm"
                      variant="outline-primary"
                      className="py-0 px-1"
                      onClick={() => handlePreview(attachment)}
                      style={{ fontSize: "0.7rem" }}
                    >
                      <i className="bi bi-eye"></i>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    className="py-0 px-1"
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "0.7rem" }}
                  >
                    <i className="bi bi-download"></i>
                  </Button>
                  {canDelete && (
                    <Button
                      size="sm"
                      variant="outline-danger"
                      className="py-0 px-1"
                      onClick={() => handleDelete(attachment)}
                      style={{ fontSize: "0.7rem" }}
                    >
                      <i className="bi bi-trash"></i>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal show={showPreview} onHide={handleClosePreview} size="lg" centered>
        <Modal.Header closeButton className="bg-light">
          <Modal.Title className="fs-6">{selectedFile?.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{renderFilePreview()}</Modal.Body>
        <Modal.Footer className="bg-light">
          <Button
            size="sm"
            variant="outline-primary"
            href={`${import.meta.env.VITE_API_ADDRESS}/uploads/${selectedFile?.name}`}
            target="_blank"
            rel="noreferrer"
          >
            Открыть в новой вкладке
          </Button>
          <Button
            size="sm"
            variant="primary"
            href={`${import.meta.env.VITE_API_ADDRESS}/uploads/${selectedFile?.name}`}
            download={selectedFile?.name}
          >
            Скачать
          </Button>
          <Button size="sm" variant="secondary" onClick={handleClosePreview}>
            Закрыть
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal show={showDeleteModal} onHide={cancelDelete} centered>
        <Modal.Header closeButton>
          <Modal.Title>Подтверждение удаления</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Вы действительно хотите удалить файл?</p>
          <p className="fw-bold text-break">{fileToDelete?.name}</p>
          <Alert variant="warning" className="small">
            <i className="bi bi-exclamation-triangle me-1"></i>
            Это действие нельзя будет отменить.
          </Alert>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={cancelDelete}>
            Отмена
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            <i className="bi bi-trash me-1"></i>
            Удалить
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AttachmentPreview;
