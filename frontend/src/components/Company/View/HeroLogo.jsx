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

import { getLocalStorageData } from "../../../util/auth";
import CompanyLogo from "../CompanyLogo";

// Логотип hero карточки компании: плитка (монограмма без файла); у менеджеров —
// загрузка с квадратным кадрированием (карточка — единственное место смены
// логотипа, в форме правки его нет). Механика кропа — как у User/CardAvatar,
// но кроп квадратный (язык записей — плитка, круг остаётся людям); endpoint —
// прежний PATCH …/add-profile-image.
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

const HeroLogo = ({ company, canEdit }) => {
  const [preview, setPreview] = useState(undefined);
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
        `${API}/api/companies/${company._id}/add-profile-image`,
        {
          method: "PATCH",
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
      useToastStore.getState().showToast("success", "Логотип обновлён");
      close();
    } catch (uploadError) {
      setError(
        uploadError.message || "Что-то пошло не так, попробуйте ещё раз",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex-none">
      <CompanyLogo
        company={company}
        src={preview}
        sizeClass="size-14"
        textClass="text-2xl"
        className="rounded-2xl"
      />

      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            title="Изменить логотип"
            aria-label="Изменить логотип"
            className="absolute -right-2 -bottom-2 grid size-7 cursor-pointer appearance-none place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RiCameraLine size={13} />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={onFileSelect}
            className="hidden"
          />
        </>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
      >
        <DialogContent className="max-w-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Выберите область для загрузки</DialogTitle>
          </DialogHeader>

          {error && <p className="my-0 text-sm text-destructive">{error}</p>}

          {imgSrc && (
            <div className="flex justify-center overflow-hidden rounded-xl border border-border bg-accent p-2">
              <ReactCrop
                crop={crop}
                onChange={(pixelCrop) => setCrop(pixelCrop)}
                aspect={1}
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

          <DialogFooter className="mt-2">
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

export default HeroLogo;
