import { useEffect, useRef, useState } from "react";

import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
} from "react-icons/ri";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import AlertMessage from "@/components/app/AlertMessage";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import Spinner from "@/components/app/Spinner";
import { cn } from "@/lib/utils";


// Зеркалит лимиты backend/middleware/imageUpload.js.
const MAX_PHOTOS = 10;
const MAX_FILE_SIZE_MB = 15;
const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif";

export const photoUrl = (photo) =>
  `${import.meta.env.VITE_API_ADDRESS}/uploads/${photo.name}`;

/**
 * Просмотр в полном размере. Одно фото — снимок, несколько — листалка стрелками,
 * клавишами ←/→ и свайпом. Автопрокрутки нет: это документация актива (наклейка
 * с серийником, скол, разъём), а не слайд-шоу.
 *
 * Кадр — `div` с `background-image`, а не `<img>`: глобальный автоскейл
 * `img { width/height: auto !important }` в `index.css` перебил бы любые размеры
 * (см. docs/ux-ui-guide.md, «Инфраструктура»).
 */
const PhotoViewer = ({ photos, index, onIndexChange, onClose }) => {
  const isOpen = index !== null && photos.length > 0;
  const safeIndex = isOpen ? Math.min(index, photos.length - 1) : 0;
  const current = isOpen ? photos[safeIndex] : null;
  const touchStart = useRef(null);

  // Последнее фото удалили из-под открытого просмотра — закрываем.
  useEffect(() => {
    if (index !== null && photos.length === 0) onClose();
  }, [index, photos.length, onClose]);

  const step = (delta) =>
    onIndexChange((safeIndex + delta + photos.length) % photos.length);

  useEffect(() => {
    if (!isOpen || photos.length < 2) return undefined;
    const onKey = (event) => {
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, safeIndex, photos.length]);

  if (!isOpen) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogTitle className="sr-only">
          {current.originalName || "Фото"}
        </DialogTitle>

        <div className="relative">
          <div
            role="img"
            aria-label={current.originalName || "Фото"}
            onTouchStart={(event) => {
              touchStart.current = event.touches[0].clientX;
            }}
            onTouchEnd={(event) => {
              if (touchStart.current === null || photos.length < 2) return;
              const delta =
                event.changedTouches[0].clientX - touchStart.current;
              if (Math.abs(delta) > 40) step(delta < 0 ? 1 : -1);
              touchStart.current = null;
            }}
            className="rounded-lg bg-accent bg-contain bg-center bg-no-repeat"
            // Высота кадра — явная: контейнер диалога её не задаёт, а
            // background-размеру нужна опора (как у графиков отчётов).
            style={{
              height: "min(70vh, 640px)",
              backgroundImage: `url(${photoUrl(current)})`,
            }}
          />

          {photos.length > 1 && (
            <>
              <Button
                variant="outline"
                size="icon"
                aria-label="Предыдущее фото"
                onClick={() => step(-1)}
                className="absolute top-1/2 left-2 -translate-y-1/2 bg-background/80"
              >
                <RiArrowLeftSLine />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Следующее фото"
                onClick={() => step(1)}
                className="absolute top-1/2 right-2 -translate-y-1/2 bg-background/80"
              >
                <RiArrowRightSLine />
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {current.originalName}
          </span>
          {photos.length > 1 && (
            <span className="flex-none font-mono tabular-nums">
              {safeIndex + 1} / {photos.length}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Контактный лист снимков сущности: равные квадраты, ни один не главнее — это
 * документация актива, а не витрина. Общий блок карточек устройства, модели,
 * типа и вендора.
 *
 * `endpoint` — базовый URL коллекции фото сущности (POST сюда, DELETE сюда/:id).
 * `inherited` — фото модели, которые показываются, пока у экземпляра нет своих
 * (только для просмотра: удалять чужую сущность отсюда нельзя).
 *
 * Список фото — состояние компонента: меняется только его же действиями, а
 * каждый ответ сервера приходит полным списком. Пересобрать под другую сущность
 * — через `key={id}` на стороне страницы.
 */
const PhotoGallery = ({
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
      const response = await fetch(endpoint, {
        method: "POST",
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.message || "Не удалось загрузить фото");
      setPhotos(data.photos);
      // Шапка страницы показывает первый снимок — ей нужны свежие данные.
      onChange?.(data.photos);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}/${pendingDelete._id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.message || "Не удалось удалить фото");
      setPhotos(data.photos);
      onChange?.(data.photos);
      setPendingDelete(null);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // Скрываем блок целиком, когда показывать нечего и добавить нельзя.
  if (shown.length === 0 && !canManage) return null;

  return (
    <>
      {error && <AlertMessage variant="danger" message={error} />}

      {isInherited && (
        <p className="mt-0 mb-3 text-sm text-muted-foreground">
          Показаны фотографии модели
          {inherited.title ? ` ${inherited.title}` : ""}.
          {canManage
            ? " Загрузите снимки этого экземпляра — они заменят их на карточке."
            : ""}
        </p>
      )}

      <div
        className="grid gap-3"
        // auto-fill/minmax встроенной сеткой tw не выражается, а произвольных
        // значений в классах не пишем (см. docs/ux-ui-guide.md) — инлайном.
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(7rem, 1fr))" }}
      >
        {shown.map((photo, index) => (
          <div
            key={photo._id}
            className="group relative aspect-square overflow-hidden rounded-lg bg-accent"
          >
            <button
              type="button"
              onClick={() => setViewerIndex(index)}
              title="Открыть в полном размере"
              aria-label={`Открыть фото ${photo.originalName || ""}`}
              className="block size-full cursor-zoom-in appearance-none border-0 bg-cover bg-center p-0 transition-transform group-hover:scale-105"
              style={{ backgroundImage: `url(${photoUrl(photo)})` }}
            />
            {canManage && !isInherited && (
              <button
                type="button"
                onClick={() => setPendingDelete(photo)}
                title="Удалить фото"
                aria-label={`Удалить фото ${photo.originalName || ""}`}
                className="absolute top-1.5 right-1.5 grid size-8 cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-background/85 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                <RiDeleteBinLine size={16} />
              </button>
            )}
          </div>
        ))}

        {canManage && !isFull && (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              if (!isFull) upload(event.dataTransfer.files);
            }}
            className={cn(
              "aspect-square rounded-lg transition-colors",
              isDragging ? "bg-primary/10" : "bg-transparent",
            )}
            // Пунктир задаём инлайном: без preflight классы border-dashed
            // рисуют бокс по всем сторонам (см. docs/ux-ui-guide.md).
            style={{
              border: `1px dashed ${isDragging ? "var(--primary)" : "var(--border)"}`,
            }}
          >
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={isUploading}
              className="flex size-full cursor-pointer appearance-none flex-col items-center justify-center gap-1 border-0 bg-transparent text-muted-foreground hover:text-foreground disabled:cursor-default"
            >
              {isUploading ? (
                <Spinner />
              ) : (
                <>
                  <RiAddLine size={22} aria-hidden />
                  <span className="text-sm font-medium">Новое фото</span>
                  <span className="text-xs text-faint">или перетащите</span>
                </>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept={ACCEPT}
              multiple
              onChange={(event) => upload(event.target.files)}
            />
          </div>
        )}
      </div>

      {canManage && (
        <p className="mt-2.5 mb-0 text-sm text-muted-foreground">
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

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Удалить фото"
        description={
          <>
            Фото «{pendingDelete?.originalName || "без имени"}» будет удалено
            безвозвратно.
          </>
        }
        confirmLabel="Удалить"
        confirmVariant="destructive"
        confirmIcon={<RiDeleteBinLine />}
        isLoading={isDeleting}
        onConfirm={handleDelete}
      />
    </>
  );
};

export default PhotoGallery;
