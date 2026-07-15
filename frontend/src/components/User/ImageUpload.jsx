import { useRef, useState } from "react";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import AlertMessage from "@/components/app/AlertMessage";
import useToastStore from "../../store/toast-store";

import { getLocalStorageData } from "../../util/auth";

// Смена фото профиля (мигрированная страница «Мой аккаунт»): кнопка открывает
// выбор файла, дальше — диалог с круглой обрезкой (ReactCrop) и загрузкой.
// Механика легаси сохранена: canvas-кроп → POST add-profile-image.
function ImageUpload({ userId, setProfileImage }) {
  const { showToast } = useToastStore();

  const [imgSrc, setImgSrc] = useState("");
  const [crop, setCrop] = useState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

  const imgRef = useRef(null);
  const fileInputRef = useRef(null);

  function centerAspectCrop(mediaWidth, mediaHeight, aspect) {
    const width = Math.min(mediaWidth, mediaHeight);
    return centerCrop(
      makeAspectCrop(
        {
          unit: "px",
          width,
        },
        aspect,
        mediaWidth,
        mediaHeight,
      ),
      mediaWidth,
      mediaHeight,
    );
  }

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    // сбрасываем value, чтобы повторный выбор того же файла снова сработал
    e.target.value = "";
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/gif"];
    if (!validTypes.includes(file.type)) {
      showToast(
        "danger",
        "Пожалуйста, выберите файл с изображением (jpg, png, gif)",
      );
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast("danger", "Размер файла не должен превышать 5Мб");
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

  const onImageLoad = (e) => {
    const { width, height } = e.currentTarget;
    setCrop(centerAspectCrop(width, height, 1));
  };

  const createCroppedImage = async (crop) => {
    if (!imgRef.current || !crop) return null;

    const image = imgRef.current;
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
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            console.error("Canvas is empty");
            return;
          }
          resolve(blob);
        },
        "image/jpeg",
        0.95,
      );
    });
  };

  const handleUpload = async () => {
    if (!imgRef.current || !crop) {
      setError("Сначала выберите область изображения");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { token } = getLocalStorageData();
      if (!token) {
        throw new Error("Authentication token not found");
      }

      const croppedImageBlob = await createCroppedImage(crop);
      if (!croppedImageBlob) {
        throw new Error("Failed to crop image");
      }

      const formData = new FormData();
      formData.append("profileImage", croppedImageBlob, "profile.jpg");

      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/users/${userId}/add-profile-image`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Загрузка не удалась");
      }

      const data = await response.json();
      setProfileImage(
        `${import.meta.env.VITE_API_ADDRESS}/uploads/${data.profileImagePath}`,
      );

      setOpen(false);
      showToast("success", "Фото профиля обновлено");
    } catch (error) {
      console.error("Error:", error);
      setError(error.message || "Что-то пошло не так, попробуйте ещё раз");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleFileSelect}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
      >
        Сменить фото
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Выберите область для загрузки</DialogTitle>
          </DialogHeader>
          {error && (
            <AlertMessage variant="danger" message={error} className="tw:my-0" />
          )}
          <div className="tw:flex tw:justify-center tw:overflow-hidden">
            <ReactCrop
              crop={crop}
              onChange={(pixelCrop) => setCrop(pixelCrop)}
              aspect={1}
              circularCrop
              unit="px"
            >
              <img
                ref={imgRef}
                alt="Область обрезки"
                src={imgSrc}
                onLoad={onImageLoad}
                className="tw:max-h-96 tw:max-w-full"
              />
            </ReactCrop>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Закрыть
            </Button>
            <Button
              type="button"
              onClick={handleUpload}
              disabled={!imgSrc || !crop || loading}
            >
              {loading ? "Загружаю…" : "Загрузить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ImageUpload;
