import { useRef, useState } from "react";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { RiCameraLine } from "react-icons/ri";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import useToastStore from "@/store/toast-store";

import { getLocalStorageData } from "../../util/auth";
import UserAvatar from "./UserAvatar";

// Аватар карточки: круг с кольцом-присутствием (как в списке); у менеджеров —
// загрузка фото с кадрированием 1:1 по кругу (карточка — единственное место
// смены аватара, в форме правки его нет). Логика кропа перенесена из легаси
// UI/AvatarUpload: валидация → FileReader → react-image-crop → canvas → blob.
// Аватар рисуем фоном на <span>, а не <img>, в обход глобального
// img{width/height:auto!important}.
const API = import.meta.env.VITE_API_ADDRESS;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 МБ
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif"];

const centerAspectCrop = (mediaWidth, mediaHeight) => {
  const width = Math.min(mediaWidth, mediaHeight);
  return centerCrop(
    makeAspectCrop({ unit: "px", width }, 1, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight,
  );
};

const CardAvatar = ({ user, ringColor, canEdit }) => {
  const [preview, setPreview] = useState(
    user.profileImagePath ? `${API}/uploads/${user.profileImagePath}` : null,
  );
  const [imgSrc, setImgSrc] = useState("");
  const [crop, setCrop] = useState();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const imgRef = useRef(null);
  const inputRef = useRef(null);

  const close = () => {
    setOpen(false);
    setImgSrc("");
    setCrop(undefined);
    setError(null);
  };

  const onFileSelect = (event) => {
    const file = event.target.files?.[0];
    // сбрасываем value: повторный выбор того же файла снова сработает
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Выберите файл с изображением (jpg, png, gif)");
      setOpen(true);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("Размер файла не должен превышать 5 МБ");
      setOpen(true);
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setImgSrc(reader.result?.toString() || "");
      setError(null);
      setOpen(true);
    });
    reader.readAsDataURL(file);
  };

  const onImageLoad = (event) => {
    const { width, height } = event.currentTarget;
    setCrop(centerAspectCrop(width, height));
  };

  const createCroppedBlob = async () => {
    const image = imgRef.current;
    if (!image || !crop) return null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    canvas.width = crop.width * scaleX;
    canvas.height = crop.height * scaleY;

    ctx.drawImage(
      image,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.95);
    });
  };

  const upload = async () => {
    if (!imgRef.current || !crop) {
      setError("Сначала выберите область");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { token } = getLocalStorageData();
      if (!token) throw new Error("Токен авторизации не найден");

      const blob = await createCroppedBlob();
      if (!blob) throw new Error("Не удалось обрезать изображение");

      const form = new FormData();
      form.append("profileImage", blob, "profile.jpg");

      const response = await fetch(
        `${API}/api/users/${user._id}/add-profile-image`,
        {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: form,
        },
      );
      if (!response.ok) throw new Error("Загрузка не удалась");

      const data = await response.json().catch(() => ({}));
      setPreview(
        data.profileImagePath
          ? `${API}/uploads/${data.profileImagePath}`
          : URL.createObjectURL(blob),
      );
      useToastStore.getState().showToast("success", "Фото обновлено");
      close();
    } catch (uploadError) {
      setError(uploadError.message || "Что-то пошло не так, попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tw:relative tw:flex-none">
      <UserAvatar
        user={user}
        src={preview}
        sizeClass="tw:size-20"
        textClass="tw:text-2xl"
        ringColor={ringColor}
        ring="lg"
      />

      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            title="Изменить фото"
            aria-label="Изменить фото"
            className="tw:absolute tw:right-0 tw:bottom-0 tw:grid tw:size-8 tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-full tw:border-2 tw:border-card tw:bg-primary tw:text-primary-foreground tw:transition-colors tw:hover:bg-primary/90"
          >
            <RiCameraLine size={15} />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={onFileSelect}
            className="tw:hidden"
          />
        </>
      )}

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="tw:max-w-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Выберите область для загрузки</DialogTitle>
          </DialogHeader>

          {error && <p className="tw:my-0 tw:text-sm tw:text-destructive">{error}</p>}

          {imgSrc && (
            <div className="tw:flex tw:justify-center tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-accent tw:p-2">
              <ReactCrop
                crop={crop}
                onChange={(pixelCrop) => setCrop(pixelCrop)}
                aspect={1}
                circularCrop
                unit="px"
              >
                <img
                  ref={imgRef}
                  alt="Кадрирование"
                  src={imgSrc}
                  onLoad={onImageLoad}
                  style={{ maxWidth: "100%", maxHeight: "58vh" }}
                />
              </ReactCrop>
            </div>
          )}

          <DialogFooter className="tw:mt-2">
            <Button variant="ghost" type="button" onClick={close}>
              Отмена
            </Button>
            <Button onClick={upload} disabled={!imgSrc || !crop || busy}>
              {busy ? "Загружаю…" : "Загрузить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CardAvatar;
