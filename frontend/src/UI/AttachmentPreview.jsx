import { useEffect, useState } from "react";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Image from "react-bootstrap/Image";
import Modal from "react-bootstrap/Modal";
import Spinner from "react-bootstrap/Spinner";
import Alert from "react-bootstrap/Alert";
import Accordion from "react-bootstrap/Accordion";
import AudioPlayer from "react-h5-audio-player";
import "react-h5-audio-player/lib/styles.css";

// react-h5-audio-player@3.10.0-rc.1 поставляется без defaultProps: при
// showJumpControls, но без явного progressJumpSteps, обработчики перемотки
// читают .backward/.forward у undefined и роняют приложение (Sentry:
// "undefined is not an object (evaluating 'e.backward')"). Задаём шаги явно.
const AUDIO_JUMP_STEPS = { backward: 5000, forward: 5000 };

const AttachmentPreview = ({
  attachments,
  compact = false,
  showAudioPlayer = true,
  canDelete = false,
  onDelete = null,
  canTranscribe = false,
  onTranscribe = null,
  transcribingAttachmentName = "",
  openTranscriptionName = "",
}) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fileToDelete, setFileToDelete] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [openSpeechName, setOpenSpeechName] = useState("");

  useEffect(() => {
    if (openTranscriptionName) {
      setOpenSpeechName(openTranscriptionName);
    }
  }, [openTranscriptionName]);

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
      m4a: "bi-music-note",
      mpeg: "bi-music-note",
      mpga: "bi-music-note",
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
    const audioExtensions = [
      "mp3",
      "m4a",
      "mpeg",
      "mpga",
      "wav",
      "webm",
      "ogg",
      "aac",
      "flac",
    ];
    return audioExtensions.includes(getFileExtension(filename));
  };

  const isSpeechRecognizable = (filename) => {
    const speechExtensions = [
      "mp3",
      "mp4",
      "mpeg",
      "mpga",
      "m4a",
      "wav",
      "webm",
    ];
    return speechExtensions.includes(getFileExtension(filename));
  };

  const renderSpeechToText = (speechToText) => {
    if (speechToText.status === "error") {
      return (
        <Alert variant="danger" className="mb-0">
          {speechToText.error || "Не удалось распознать аудиофайл"}
        </Alert>
      );
    }

    if (speechToText.status !== "ready") {
      return null;
    }

    const segments = Array.isArray(speechToText.segments)
      ? speechToText.segments
      : [];

    if (segments.length > 0) {
      return (
        <div className="d-flex flex-column gap-2">
          {segments.map((segment, index) => (
            <div key={index}>
              <span className="fw-bold">{segment.speaker}: </span>
              <span style={{ whiteSpace: "pre-wrap" }}>{segment.text}</span>
            </div>
          ))}
        </div>
      );
    }

    const fallback = speechToText.text || speechToText.summary;

    if (fallback) {
      return <div style={{ whiteSpace: "pre-wrap" }}>{fallback}</div>;
    }

    return null;
  };

  const audioActionButtonStyle = {
    width: "32px",
    height: "32px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontSize: "1rem",
    lineHeight: 1,
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
          {loading && (
            <div className="mb-3">
              <Spinner animation="border" variant="primary" />
              <div className="mt-2 text-muted">Загрузка аудио...</div>
            </div>
          )}
          <AudioPlayer
            src={fileUrl}
            onLoadStart={() => setLoading(false)}
            onCanPlay={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
            showJumpControls={true}
            progressJumpSteps={AUDIO_JUMP_STEPS}
            showDownloadProgress={true}
            hasDefaultKeyBindings={true}
            customProgressBarSection={[
              "CURRENT_TIME",
              "PROGRESS_BAR",
              "DURATION",
            ]}
            customControlsSection={[
              "ADDITIONAL_CONTROLS",
              "MAIN_CONTROLS",
              "VOLUME_CONTROLS",
            ]}
            style={{
              marginBottom: "1rem",
              display: loading ? "none" : "block",
            }}
          />
          {error && (
            <Alert variant="danger">
              Ошибка загрузки аудио.{" "}
              <a href={fileUrl} target="_blank" rel="noreferrer">
                Скачать файл
              </a>
            </Alert>
          )}
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
        <div className="d-flex flex-wrap gap-1">
          {attachments.map((attachment) => {
            const extension = getFileExtension(attachment.name);
            const fileUrl = `${import.meta.env.VITE_API_ADDRESS}/uploads/${attachment.name}`;

            // Для аудио файлов показываем мини-плеер
            if (isAudio(attachment.name) && showAudioPlayer) {
              const speechToText = attachment.speechToText || {};
              const isTranscribing =
                transcribingAttachmentName === attachment.name ||
                speechToText.status === "pending";

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
                      <div className="d-flex align-items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          href={fileUrl}
                          target="_blank"
                          style={audioActionButtonStyle}
                          title="Скачать"
                        >
                          <i className="bi bi-download"></i>
                        </Button>
                        {canTranscribe &&
                          isSpeechRecognizable(attachment.name) && (
                            <Button
                              size="sm"
                              variant="outline-primary"
                              onClick={() => onTranscribe?.(attachment)}
                              disabled={isTranscribing}
                              style={audioActionButtonStyle}
                              title="Распознать речь"
                            >
                              {isTranscribing ? (
                                <Spinner animation="border" size="sm" />
                              ) : (
                                <i className="bi bi-file-earmark-text"></i>
                              )}
                            </Button>
                          )}
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() => handleDelete(attachment)}
                            style={audioActionButtonStyle}
                            title="Удалить"
                          >
                            <i className="bi bi-trash"></i>
                          </Button>
                        )}
                      </div>
                    </div>
                    <AudioPlayer
                      src={fileUrl}
                      showJumpControls={true}
                      progressJumpSteps={AUDIO_JUMP_STEPS}
                      showDownloadProgress={true}
                      hasDefaultKeyBindings={true}
                      layout="horizontal"
                      customProgressBarSection={[
                        "CURRENT_TIME",
                        "PROGRESS_BAR",
                        "DURATION",
                      ]}
                      customControlsSection={[
                        "ADDITIONAL_CONTROLS",
                        "MAIN_CONTROLS",
                        "VOLUME_CONTROLS",
                      ]}
                      style={{
                        fontSize: "0.8rem",
                        "--rhap_theme-color": "#0d6efd",
                        "--rhap_background-color": "#f8f9fa",
                      }}
                      onError={(e) => {
                        console.warn("Audio player error:", e);
                      }}
                    />
                    {(speechToText.status === "ready" ||
                      speechToText.status === "error") && (
                      <Accordion
                        className="mt-2"
                        activeKey={
                          openSpeechName === attachment.name ? "speech" : null
                        }
                        onSelect={(eventKey) =>
                          setOpenSpeechName(eventKey ? attachment.name : "")
                        }
                      >
                        <Accordion.Item eventKey="speech">
                          <Accordion.Header>Итог разговора</Accordion.Header>
                          <Accordion.Body>
                            {renderSpeechToText(speechToText)}
                          </Accordion.Body>
                        </Accordion.Item>
                      </Accordion>
                    )}
                  </div>
                </div>
              );
            }

            // Для всех файлов - только иконки
            return (
              <div
                key={attachment.name}
                className="d-inline-flex align-items-center p-2 me-2 mb-1 bg-light rounded border"
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

                <div className="d-flex gap-3">
                  {isPreviewable(attachment.name) && (
                    <Button
                      variant="outline-info"
                      className="py-0 px-1"
                      onClick={() => handlePreview(attachment)}
                    >
                      <i className="bi bi-eye"></i>
                    </Button>
                  )}
                  <Button
                    variant="outline-info"
                    className="py-0 px-1"
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <i className="bi bi-download"></i>
                  </Button>
                  {canDelete && (
                    <Button
                      variant="outline-danger"
                      className="py-0 px-1"
                      onClick={() => handleDelete(attachment)}
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
