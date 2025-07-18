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

  // Определяем браузер
  const isChrome = () => {
    try {
      return (
        /Chrome/.test(navigator.userAgent) &&
        /Google Inc/.test(navigator.vendor)
      );
    } catch {
      return false;
    }
  };

  // Проверяем наличие кириллицы в строке
  const hasCyrillic = (text) => {
    try {
      if (!text || typeof text !== "string") return false;
      return /[а-яёА-ЯЁ]/.test(text);
    } catch {
      return false;
    }
  };

  // Безопасное получение свойств файла для Chrome
  const safeGetFileProperty = (file, property, defaultValue = "") => {
    try {
      if (!file) return defaultValue;
      const value = file[property];
      return value !== undefined ? value : defaultValue;
    } catch (error) {
      console.warn(`Error accessing file.${property}:`, error);
      return defaultValue;
    }
  };

  // Транслитерация кириллицы
  const transliterate = (text) => {
    if (!text || typeof text !== "string") return "file";

    const cyrillicToLatin = {
      а: "a",
      б: "b",
      в: "v",
      г: "g",
      д: "d",
      е: "e",
      ё: "yo",
      ж: "zh",
      з: "z",
      и: "i",
      й: "y",
      к: "k",
      л: "l",
      м: "m",
      н: "n",
      о: "o",
      п: "p",
      р: "r",
      с: "s",
      т: "t",
      у: "u",
      ф: "f",
      х: "h",
      ц: "ts",
      ч: "ch",
      ш: "sh",
      щ: "sch",
      ъ: "",
      ы: "y",
      ь: "",
      э: "e",
      ю: "yu",
      я: "ya",
      А: "A",
      Б: "B",
      В: "V",
      Г: "G",
      Д: "D",
      Е: "E",
      Ё: "Yo",
      Ж: "Zh",
      З: "Z",
      И: "I",
      Й: "Y",
      К: "K",
      Л: "L",
      М: "M",
      Н: "N",
      О: "O",
      П: "P",
      Р: "R",
      С: "S",
      Т: "T",
      У: "U",
      Ф: "F",
      Х: "H",
      Ц: "Ts",
      Ч: "Ch",
      Ш: "Sh",
      Щ: "Sch",
      Ъ: "",
      Ы: "Y",
      Ь: "",
      Э: "E",
      Ю: "Yu",
      Я: "Ya",
    };

    try {
      return text.replace(
        /[а-яёА-ЯЁ]/g,
        (char) => cyrillicToLatin[char] || char,
      );
    } catch (error) {
      console.warn("Transliteration error:", error);
      return text;
    }
  };

  // Безопасное получение расширения файла
  const getFileExtension = (filename) => {
    try {
      if (!filename || typeof filename !== "string") return "unknown";

      const lastDotIndex = filename.lastIndexOf(".");
      if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) {
        return "unknown";
      }

      return filename.substring(lastDotIndex + 1).toLowerCase();
    } catch (error) {
      console.warn("Error getting file extension:", error);
      return "unknown";
    }
  };

  // Создание безопасного имени файла (только для отображения)
  const createSafeDisplayName = (originalName) => {
    try {
      if (!originalName || typeof originalName !== "string") {
        return `file_${Date.now()}.txt`;
      }

      const lastDotIndex = originalName.lastIndexOf(".");
      let nameWithoutExt, extension;

      if (lastDotIndex === -1) {
        nameWithoutExt = originalName;
        extension = "txt";
      } else {
        nameWithoutExt = originalName.substring(0, lastDotIndex);
        extension = originalName.substring(lastDotIndex + 1);
      }

      // Транслитерируем и очищаем имя
      const safeName = transliterate(nameWithoutExt)
        .replace(/[^\w\s.-]/g, "")
        .replace(/\s+/g, "_")
        .replace(/_{2,}/g, "_")
        .trim()
        .substring(0, 100);

      const finalName = safeName || "file";
      return `${finalName}.${extension}`;
    } catch (error) {
      console.warn("Error creating safe filename:", error);
      return `file_${Date.now()}.txt`;
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

  // Безопасное создание превью (только для не-кириллических файлов в Chrome)
  const createImagePreview = (file) => {
    return new Promise((resolve) => {
      try {
        const fileName = safeGetFileProperty(file, "name", "");
        const fileType = safeGetFileProperty(file, "type", "");

        if (!fileType.startsWith("image/")) {
          resolve(null);
          return;
        }

        // В Chrome полностью избегаем FileReader для кириллических имен
        if (isChrome() && hasCyrillic(fileName)) {
          console.log(
            "Skipping preview for cyrillic filename in Chrome:",
            fileName,
          );
          resolve(null);
          return;
        }

        const reader = new FileReader();

        const timeout = setTimeout(() => {
          console.warn("FileReader timeout for file:", fileName);
          resolve(null);
        }, 3000);

        reader.onload = (e) => {
          clearTimeout(timeout);
          try {
            resolve(e.target.result);
          } catch (error) {
            console.warn("Error processing image preview:", error);
            resolve(null);
          }
        };

        reader.onerror = (error) => {
          clearTimeout(timeout);
          console.warn("FileReader error for file:", fileName, error);
          resolve(null);
        };

        reader.onabort = () => {
          clearTimeout(timeout);
          console.warn("FileReader aborted for file:", fileName);
          resolve(null);
        };

        reader.readAsDataURL(file);
      } catch (error) {
        console.warn("Error creating image preview:", error);
        resolve(null);
      }
    });
  };

  const validateFile = (file) => {
    try {
      const fileName = safeGetFileProperty(file, "name", "");
      const fileSize = safeGetFileProperty(file, "size", 0);
      const fileType = safeGetFileProperty(file, "type", "");

      const maxSize = 100 * 1024 * 1024; // 100MB
      const allowedTypes = [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "application/pdf",
        "application/rtf",
        "text/plain",
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

      if (!file || !fileName || fileSize === undefined) {
        return { isValid: false, error: "Поврежденный файл" };
      }

      if (fileSize > maxSize) {
        return {
          isValid: false,
          error: `Файл "${fileName}" слишком большой (${Math.round(fileSize / 1024 / 1024)}MB). Максимальный размер: 100MB`,
        };
      }

      if (!allowedTypes.includes(fileType)) {
        return {
          isValid: false,
          error: `Файл "${fileName}" имеет неподдерживаемый тип`,
        };
      }

      return { isValid: true };
    } catch (error) {
      console.warn("File validation error:", error);
      return { isValid: false, error: "Ошибка при проверке файла" };
    }
  };

  // Безопасная обработка одного файла
  const processSingleFile = async (file, index) => {
    return new Promise((resolve) => {
      try {
        const fileName = safeGetFileProperty(file, "name", `file_${index}`);
        const fileSize = safeGetFileProperty(file, "size", 0);
        const fileType = safeGetFileProperty(
          file,
          "type",
          "application/octet-stream",
        );

        // В Chrome с кириллическими именами делаем минимальную обработку
        if (isChrome() && hasCyrillic(fileName)) {
          const safeDisplayName = createSafeDisplayName(fileName);

          const preview = {
            name: safeDisplayName,
            originalName: fileName,
            size: fileSize,
            type: fileType,
            extension: getFileExtension(safeDisplayName),
            dataUrl: null,
          };

          resolve({
            file: file,
            preview: preview,
            nameChanged: fileName !== safeDisplayName,
          });
          return;
        }

        // Обычная обработка для других случаев
        setTimeout(async () => {
          try {
            const validation = validateFile(file);
            if (!validation.isValid) {
              resolve({ error: validation.error });
              return;
            }

            const safeDisplayName = createSafeDisplayName(fileName);

            const preview = {
              name: safeDisplayName,
              originalName: fileName,
              size: fileSize,
              type: fileType,
              extension: getFileExtension(safeDisplayName),
              dataUrl: null,
            };

            // Создаем превью только если это безопасно
            if (isImage(fileName)) {
              try {
                preview.dataUrl = await createImagePreview(file);
              } catch (previewError) {
                console.warn(
                  "Preview creation failed:",
                  fileName,
                  previewError,
                );
                preview.dataUrl = null;
              }
            }

            resolve({
              file: file,
              preview: preview,
              nameChanged: fileName !== safeDisplayName,
            });
          } catch (error) {
            console.warn("Error processing file:", fileName, error);
            resolve({ error: `Ошибка при обработке файла "${fileName}"` });
          }
        }, index * 50); // Небольшая задержка между файлами
      } catch (error) {
        console.error("Critical error in processSingleFile:", error);
        resolve({ error: "Критическая ошибка при обработке файла" });
      }
    });
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

      // Безопасное преобразование FileList в массив для Chrome
      let pickedFiles;
      try {
        pickedFiles = Array.from(event.target.files);
      } catch (error) {
        console.error("Error converting FileList to Array:", error);
        setValidationErrors(["Ошибка при чтении выбранных файлов"]);
        setIsValid(false);
        setFilePreviews([]);
        props.setFiles([]);
        return;
      }

      const processedFiles = [];
      const previews = [];
      const errors = [];

      // Обрабатываем файлы последовательно
      for (let i = 0; i < pickedFiles.length; i++) {
        const result = await processSingleFile(pickedFiles[i], i);

        if (result.error) {
          errors.push(result.error);
        } else {
          processedFiles.push(result.file);
          previews.push(result.preview);
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
      <Form.Group>
        {props.showLabel && <Form.Label>Прикрепить файлы</Form.Label>}
        <Form.Control
          id="attachments"
          name="attachments"
          type="file"
          accept=".png,.jpeg,.jpg,.pdf,.rtf,.txt,.docx,.xlsx,.pptx,.rar,.tar,.zip,.7z,.mp3,.mp4"
          multiple
          ref={filePickerRef}
          onChange={pickedHandler}
        />
        {props.showText && (
          <Form.Text muted>
            Изображения png, jpeg, jpg, документы pdf, rtf, docx, xlsx, pptx,
            архивы rar, tar, zip, 7z, медиа mp3, mp4
          </Form.Text>
        )}
      </Form.Group>

      {validationErrors.length > 0 && (
        <div className="mt-2">
          {validationErrors.map((error, index) => (
            <Alert
              key={index}
              variant={error.includes("будет сохранен") ? "info" : "warning"}
              className="py-2 mb-1"
            >
              <i
                className={
                  error.includes("будет сохранен")
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
        <div className="mt-2">
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
                        if (e.target.nextSibling) {
                          e.target.nextSibling.style.display = "block";
                        }
                      }}
                    />
                  ) : null}

                  <i
                    className={`${getFileIcon(preview.name)} text-primary`}
                    style={{
                      fontSize: "1.8rem",
                      display: preview.dataUrl ? "none" : "block",
                    }}
                  ></i>
                </div>

                <div className="text-center mt-1">
                  <div
                    className="text-truncate"
                    style={{ fontSize: "0.65rem", maxWidth: "70px" }}
                    title={`${preview.originalName}${preview.originalName !== preview.name ? ` → ${preview.name}` : ""}`}
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
