import { useEffect, useRef, useState } from "react";

import Alert from "react-bootstrap/Alert";
import Carousel from "react-bootstrap/Carousel";
import Modal from "react-bootstrap/Modal";
import Spinner from "react-bootstrap/Spinner";

import { RiAddLine, RiCloseLine, RiDeleteBinLine } from "react-icons/ri";

import ConfirmActionModal from "../../UI/ConfirmActionModal";
import { getLocalStorageData } from "../../util/auth";

// Зеркалит лимиты backend/middleware/imageUpload.js.
const MAX_PHOTOS = 10;
const MAX_FILE_SIZE_MB = 15;
const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif";

export const photoUrl = (photo) =>
  `${import.meta.env.VITE_API_ADDRESS}/uploads/${photo.name}`;

// Просмотр в полном размере. Одно фото — просто снимок; несколько — карусель со
// стрелками, точками и свайпом. Автопрокрутки нет: это документация, а не слайд-шоу.
export const PhotoViewer = ({ photos, index, onIndexChange, onClose }) => {
  const isOpen = index !== null && photos.length > 0;
  const current = isOpen ? photos[Math.min(index, photos.length - 1)] : null;

  // Последнее фото удалили из-под открытого просмотра — закрываем.
  useEffect(() => {
    if (index !== null && photos.length === 0) onClose();
  }, [index, photos.length, onClose]);

  if (!isOpen) return null;

  const frame = (photo) => (
    <div className="photo-viewer__frame">
      <img
        className="photo-viewer__img"
        src={photoUrl(photo)}
        alt={photo.originalName || "Фото устройства"}
      />
    </div>
  );

  return (
    <Modal
      show
      onHide={onClose}
      size="xl"
      centered
      dialogClassName="photo-viewer"
      contentClassName="photo-viewer__content"
    >
      <button
        type="button"
        className="photo-viewer__close"
        onClick={onClose}
        aria-label="Закрыть просмотр"
      >
        <RiCloseLine />
      </button>

      {photos.length > 1 ? (
        <Carousel
          activeIndex={index}
          onSelect={onIndexChange}
          interval={null}
          wrap
          indicators={photos.length <= 8}
        >
          {photos.map((photo) => (
            <Carousel.Item key={photo._id}>{frame(photo)}</Carousel.Item>
          ))}
        </Carousel>
      ) : (
        frame(current)
      )}

      <div className="photo-viewer__caption">
        <span className="text-truncate">{current.originalName}</span>
        {photos.length > 1 && (
          <span className="font-monospace flex-shrink-0">
            {index + 1} / {photos.length}
          </span>
        )}
      </div>
    </Modal>
  );
};

// Снимок в шапке страницы: первое фото вместо иконки-заглушки. Клик открывает
// весь набор в полном размере. Без фото — переданная иконка.
//
// Размер по умолчанию равен внешнему боксу QR-кода на той же странице (128 px
// самого кода + p-1 по 4 px с каждой стороны), а верхние края выровнены — фото
// и QR читаются как пара.
export const PhotoThumb = ({ photos = [], icon, size = 136 }) => {
  const [viewerIndex, setViewerIndex] = useState(null);
  const box = { width: size, height: size };

  if (photos.length === 0) {
    return (
      <div
        className="photo-thumb photo-thumb--empty d-flex align-items-center justify-content-center flex-shrink-0 align-self-sm-start text-body-secondary"
        style={{ ...box, fontSize: "2.75rem" }}
      >
        {icon}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="photo-thumb flex-shrink-0 align-self-sm-start"
        style={box}
        onClick={() => setViewerIndex(0)}
        title="Открыть в полном размере"
        aria-label={`Открыть фотографии (${photos.length})`}
      >
        <img src={photoUrl(photos[0])} alt={photos[0].originalName || ""} />
        {photos.length > 1 && (
          <span className="photo-thumb__count font-monospace">
            {photos.length}
          </span>
        )}
      </button>

      <PhotoViewer
        photos={photos}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    </>
  );
};

// Снимки устройства или его модели: контактный лист квадратных плиток, клик —
// просмотр в полном размере (карусель, если фото больше одного).
//
// `endpoint` — базовый URL коллекции фото сущности (POST сюда, DELETE сюда/:id).
// `inherited` — фото модели, которые показываются, пока у экземпляра нет своих.
//
// Список фото — состояние компонента: меняется только его же действиями, а
// каждый ответ сервера приходит полным списком. Пересобрать под другую сущность
// — через key={id} на стороне страницы.
const DevicePhotos = ({
  endpoint,
  photos: initial = [],
  canManage,
  inherited,
  onChange,
}) => {
  const [photos, setPhotos] = useState(initial);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef(null);

  const isFull = photos.length >= MAX_PHOTOS;
  // Пока своих снимков нет, показываем каталожные фото модели — но только для
  // просмотра: удалять их отсюда нельзя, это чужая сущность.
  const inheritedPhotos = photos.length === 0 ? inherited?.photos || [] : [];
  const shown = photos.length > 0 ? photos : inheritedPhotos;
  const isInherited = photos.length === 0 && inheritedPhotos.length > 0;

  const upload = async (files) => {
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;

    setError("");
    if (photos.length + images.length > MAX_PHOTOS) {
      setError(
        `Всего можно хранить ${MAX_PHOTOS} фото — сейчас загружено ${photos.length}.`,
      );
      return;
    }

    const body = new FormData();
    images.forEach((image) => body.append("photos", image));

    setIsUploading(true);
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.message || "Не удалось загрузить фото");
      setPhotos(data.photos);
      // Шапка страницы показывает первый снимок — ей нужны свежие данные.
      onChange?.(data.photos);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError("");
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(`${endpoint}/${pendingDelete._id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.message || "Не удалось удалить фото");
      setPhotos(data.photos);
      onChange?.(data.photos);
      setPendingDelete(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    if (!isFull) upload(event.dataTransfer.files);
  };

  // Скрываем секцию целиком, когда показывать нечего и добавить нельзя.
  if (shown.length === 0 && !canManage) return null;

  return (
    <>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {isInherited && (
        <p className="text-body-secondary small mb-3">
          Показаны фотографии модели
          {inherited.title ? ` ${inherited.title}` : ""}.
          {canManage
            ? " Загрузите снимки этого экземпляра — они заменят их на карточке."
            : ""}
        </p>
      )}

      <div className="device-photos">
        {shown.map((photo, index) => (
          <div key={photo._id} className="device-photo">
            <button
              type="button"
              className="device-photo__open"
              onClick={() => setViewerIndex(index)}
              title="Открыть в полном размере"
            >
              <img
                className="device-photo__img"
                src={photoUrl(photo)}
                alt={photo.originalName || "Фото устройства"}
                loading="lazy"
              />
            </button>
            {canManage && !isInherited && (
              <button
                type="button"
                className="device-photo__remove"
                onClick={() => setPendingDelete(photo)}
                title="Удалить фото"
                aria-label={`Удалить фото ${photo.originalName || ""}`}
              >
                <RiDeleteBinLine />
              </button>
            )}
          </div>
        ))}

        {canManage && !isFull && (
          <div
            className={`device-photo-drop ${isDragging ? "is-dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <button
              type="button"
              className="device-photo-drop__btn"
              onClick={() => inputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <Spinner animation="border" size="sm" />
              ) : (
                <>
                  <RiAddLine className="fs-4" />
                  <span className="device-photo-drop__label">
                    Добавить фото
                  </span>
                  <span className="device-photo-drop__hint">
                    или перетащите сюда
                  </span>
                </>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              className="d-none"
              accept={ACCEPT}
              multiple
              onChange={(event) => upload(event.target.files)}
            />
          </div>
        )}
      </div>

      {canManage && (
        <p className="text-body-secondary small mb-0 mt-2">
          {isFull
            ? `Загружено ${MAX_PHOTOS} фото — предел. Удалите лишние, чтобы добавить новые.`
            : `JPEG, PNG, WebP или HEIC, до ${MAX_FILE_SIZE_MB} МБ. Не больше ${MAX_PHOTOS} фото.`}
        </p>
      )}

      <PhotoViewer
        photos={shown}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
        onClose={() => setViewerIndex(null)}
      />

      <ConfirmActionModal
        show={!!pendingDelete}
        onHide={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title="Удалить фото"
        body={
          <>
            Фото <strong>{pendingDelete?.originalName || "без имени"}</strong>{" "}
            будет удалено безвозвратно.
          </>
        }
        confirmLabel="Удалить"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </>
  );
};

export default DevicePhotos;
