import { useRef, useState, useImperativeHandle, forwardRef } from "react";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Image from "react-bootstrap/Image";
import Alert from "react-bootstrap/Alert";

const FileUpload = forwardRef((props, ref) => {
  const filePickerRef = useRef();
  const [isValid, setIsValid] = useState();
  const [filePreviews, setFilePreviews] = useState([]);
  const [validationErrors, setValidationErrors] = useState([]);

  const getFileExtension = (filename) => {
    try {
      return filename.split(".").pop().toLowerCase();
    } catch {
      return "unknown";
    }
  };

  const getFileIcon = (filename) => {
    const extension = getFileExtension(filename);
    const iconMap = {
      jpg: "bi-file-earmark-image",
      jpeg: "bi-file-earmark-image",
      png: "bi-file-earmark-image",
      gif: "bi-file-earmark-image",
      bmp: "bi-file-earmark-image",
      webp: "bi-file-earmark-image",
      svg: "bi-file-earmark-image",
      pdf: "bi-file-earmark-pdf",
      doc: "bi-file-earmark-word",
      docx: "bi-file-earmark-word",
      xls: "bi-file-earmark-excel",
      xlsx: "bi-file-earmark-excel",
      ppt: "bi-file-earmark-ppt",
      pptx: "bi-file-earmark-ppt",
      txt: "bi-file-earmark-text",
      log: "bi-file-earmark-text",
      csv: "bi-file-earmark-text",
      conf: "bi-file-earmark-text",
      json: "bi-file-earmark-code",
      xml: "bi-file-earmark-code",
      md: "bi-file-earmark-text",
      mp3: "bi-file-earmark-music",
      wav: "bi-file-earmark-music",
      ogg: "bi-file-earmark-music",
      aac: "bi-file-earmark-music",
      flac: "bi-file-earmark-music",
      mp4: "bi-file-earmark-play",
      webm: "bi-file-earmark-play",
      avi: "bi-file-earmark-play",
      mov: "bi-file-earmark-play",
      wmv: "bi-file-earmark-play",
      flv: "bi-file-earmark-play",
      zip: "bi-file-earmark-zip",
      rar: "bi-file-earmark-zip",
      "7z": "bi-file-earmark-zip",
      tar: "bi-file-earmark-zip",
      gz: "bi-file-earmark-zip",
    };
    return iconMap[extension] || "bi-file-earmark";
  };

  const isImage = (filename) => {
    try {
      const imageExtensions = [
        "jpg",
        "jpeg",
        "png",
        "gif",
        "bmp",
        "webp",
        "svg",
      ];
      return imageExtensions.includes(getFileExtension(filename));
    } catch {
      return false;
    }
  };

  const createImagePreview = (file) => {
    return new Promise((resolve) => {
      try {
        const safeFile = new File([file], file.name, { type: file.type });

        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(safeFile);
      } catch {
        resolve(null);
      }
    });
  };

  const validateFile = (file) => {
    try {
      const maxSize = 100 * 1024 * 1024; // 100MB
      const allowedTypes = [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "application/pdf",
        "application/rtf",
        "text/plain",
        "text/conf",
        "application/conf",
        "application/x-conf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.rar",
        "application/x-tar",
        "application/zip",
        "application/x-7z-compressed",
        "audio/mpeg",
        "video/mpeg",
      ];

      if (!file || !file.name || !file.size) {
        return { isValid: false, error: "Поврежденный файл" };
      }

      if (file.size > maxSize) {
        return {
          isValid: false,
          error: `Файл "${file.name}" слишком большой (${Math.round(file.size / 1024 / 1024)}MB). Максимальный размер: 100MB`,
        };
      }

      if (!allowedTypes.includes(file.type)) {
        return {
          isValid: false,
          error: `Файл "${file.name}" имеет неподдерживаемый тип`,
        };
      }

      return { isValid: true };
    } catch {
      return { isValid: false, error: "Ошибка при проверке файла" };
    }
  };

  const pickedHandler = async (event) => {
    setValidationErrors([]);

    try {
      if (!event.target.files || event.target.files.length === 0) {
        setIsValid(false);
        setFilePreviews([]);
        props.setFiles([]);
        return;
      }

      const pickedFiles = Array.from(event.target.files);
      const processedFiles = [];
      const previews = [];
      const errors = [];

      for (const originalFile of pickedFiles) {
        try {
          // Проверяем исходный файл
          const validation = validateFile(originalFile);
          if (!validation.isValid) {
            errors.push(validation.error);
            continue;
          }

          // Создаем новый объект File с безопасным именем
          const safeFile = new File([originalFile], originalFile.name, {
            type: originalFile.type,
            lastModified: originalFile.lastModified,
          });

          processedFiles.push(safeFile);

          // Создаем превью
          const preview = {
            name: originalFile.name,
            originalName: originalFile.name,
            size: originalFile.size,
            type: originalFile.type,
            extension: getFileExtension(originalFile.name),
            dataUrl: null,
          };

          if (isImage(originalFile.name)) {
            preview.dataUrl = await createImagePreview(originalFile);
          }

          previews.push(preview);
        } catch (fileError) {
          console.warn("Error processing file:", originalFile.name, fileError);
          errors.push(`Ошибка при обработке файла "${originalFile.name}"`);
        }
      }

      // Показываем уведомления
      if (errors.length > 0) {
        setValidationErrors(errors);
      }

      // Устанавливаем результат
      if (processedFiles.length > 0) {
        props.setFiles(processedFiles);
        setFilePreviews(previews);
        setIsValid(true);
      } else {
        props.setFiles([]);
        setFilePreviews([]);
        setIsValid(false);
      }
    } catch (error) {
      console.error("Critical error in file handler:", error);
      setValidationErrors([
        "Критическая ошибка при обработке файлов. Обновите страницу и попробуйте снова.",
      ]);
      setIsValid(false);
      setFilePreviews([]);
      props.setFiles([]);
    }
  };

  const removeFile = (index) => {
    try {
      const updatedFiles = Array.from(props.files || []).filter(
        (_, i) => i !== index,
      );
      const updatedPreviews = filePreviews.filter((_, i) => i !== index);

      props.setFiles(updatedFiles);
      setFilePreviews(updatedPreviews);

      if (updatedFiles.length === 0) {
        setIsValid(false);
        if (filePickerRef.current) {
          filePickerRef.current.value = "";
        }
      }
    } catch (error) {
      console.warn("Error removing file:", error);
    }
  };

  const clearAllFiles = () => {
    try {
      props.setFiles([]);
      setFilePreviews([]);
      setValidationErrors([]);
      setIsValid(false);
      if (filePickerRef.current) {
        filePickerRef.current.value = "";
      }
    } catch (error) {
      console.warn("Error clearing files:", error);
    }
  };

  useImperativeHandle(ref, () => ({
    clearFiles: clearAllFiles,
  }));

  return (
    <>
      <Form.Group className="mb-2">
        {props.showLabel && <Form.Label>Прикрепить файлы</Form.Label>}
        <Form.Control
          id="attachments"
          name="attachments"
          type="file"
          accept=".png,.jpeg,.jpg,.pdf,.rtf,.txt,.conf,.docx,.xlsx,.pptx,.rar,.tar,.zip,.7z,.mp3,.mp4"
          multiple
          ref={filePickerRef}
          onChange={pickedHandler}
        />
        {props.showText && (
          <Form.Text muted>
            Изображения png, jpeg, jpg, документы pdf, rtf, txt, conf, docx,
            xlsx, pptx, архивы rar, tar, zip, 7z, медиа mp3, mp4
          </Form.Text>
        )}
      </Form.Group>

      {validationErrors.length > 0 && (
        <div className="mt-2">
          {validationErrors.map((error, index) => (
            <Alert
              key={index}
              variant={error.includes("переименован") ? "info" : "warning"}
              className="py-2 mb-1"
            >
              <i
                className={
                  error.includes("переименован")
                    ? "bi bi-info-circle me-1"
                    : "bi bi-exclamation-triangle me-1"
                }
              ></i>
              <small>{error}</small>
            </Alert>
          ))}
        </div>
      )}

      {filePreviews.length > 0 && (
        <div className="mt-2 mb-3">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <small
              className="text-muted fw-bold"
              style={{ fontSize: "0.75rem" }}
            >
              Файлы ({filePreviews.length})
            </small>
            <Button
              variant="outline-danger"
              size="sm"
              onClick={clearAllFiles}
              className="py-0 px-1"
              style={{ fontSize: "0.7rem" }}
            >
              <i className="bi bi-trash"></i>
            </Button>
          </div>

          <div className="d-flex flex-wrap gap-1">
            {filePreviews.map((preview, index) => (
              <div
                key={index}
                className="border rounded p-1 bg-light position-relative"
                style={{ width: "80px" }}
              >
                <div className="text-center">
                  {preview.dataUrl ? (
                    <Image
                      src={preview.dataUrl}
                      thumbnail
                      style={{
                        width: "40px",
                        height: "40px",
                        objectFit: "cover",
                      }}
                      onError={(e) => {
                        e.target.style.display = "none";
                      }}
                    />
                  ) : (
                    <i
                      className={`${getFileIcon(preview.name)} text-primary`}
                      style={{ fontSize: "1.8rem" }}
                    ></i>
                  )}
                </div>

                <div className="text-center mt-1">
                  <div
                    className="text-truncate"
                    style={{ fontSize: "0.65rem", maxWidth: "70px" }}
                    title={`${preview.originalName || preview.name}${preview.originalName !== preview.name ? ` → ${preview.name}` : ""}`}
                  >
                    {preview.name}
                  </div>
                  <Badge bg="secondary" style={{ fontSize: "0.55rem" }}>
                    {preview.extension.toUpperCase()}
                  </Badge>
                </div>

                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={() => removeFile(index)}
                  className="position-absolute top-0 end-0 p-0"
                  style={{
                    fontSize: "0.6rem",
                    width: "16px",
                    height: "16px",
                    transform: "translate(25%, -25%)",
                  }}
                >
                  <i className="bi bi-x"></i>
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isValid && props.errorText && (
        <Alert variant="danger" className="mt-2 py-2">
          <small>{props.errorText}</small>
        </Alert>
      )}
    </>
  );
});

export default FileUpload;
