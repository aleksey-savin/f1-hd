import { useRef, useState } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";

import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import { RiCameraLine } from "react-icons/ri";

import { getLocalStorageData } from "../util/auth";

import "../css/AvatarUpload.css";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif"];

function centerAspectCrop(mediaWidth, mediaHeight, aspect) {
  const width = Math.min(mediaWidth, mediaHeight);
  return centerCrop(
    makeAspectCrop({ unit: "px", width }, aspect, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight,
  );
}

// Единый аватар-загрузчик для шапок пользователя и компании.
// Рисует круглую аватарку с кольцом-статусом (.account-avatar); при наличии
// прав (canEdit) аватар становится кнопкой: наведение → оверлей «Изменить фото»,
// клик → выбор файла → кадрирование (1:1, круг) → загрузка на uploadUrl.
// Эндпоинт/метод задаются пропсами — компания шлёт PATCH, пользователь POST.
function AvatarUpload({
  image,
  onChange,
  uploadUrl,
  method = "POST",
  fieldName = "profileImage",
  ringOn = true,
  canEdit = false,
  alt = "",
  placeholder,
  label = "Изменить фото",
}) {
  const [imgSrc, setImgSrc] = useState("");
  const [crop, setCrop] = useState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [show, setShow] = useState(false);

  const imgRef = useRef(null);
  const inputRef = useRef(null);

  const avatarClass = `account-avatar ${ringOn ? "" : "account-avatar--off"}`;
  const avatarStyle = { backgroundImage: `url(${image || placeholder})` };

  // Без прав — просто аватар (без оверлея и модалки)
  if (!canEdit) {
    return (
      <div
        className={avatarClass}
        style={avatarStyle}
        role="img"
        aria-label={alt}
      />
    );
  }

  const handleClose = () => {
    setShow(false);
    setImgSrc("");
    setCrop(undefined);
    setError(null);
  };

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    // сбрасываем value: повторный выбор того же файла снова сработает
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Пожалуйста, выберите файл с изображением (jpg, png, gif)");
      setShow(true);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("Размер файла не должен превышать 5Мб");
      setShow(true);
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setImgSrc(reader.result?.toString() || "");
      setError(null);
      setShow(true);
    });
    reader.readAsDataURL(file);
  };

  const onImageLoad = (event) => {
    const { width, height } = event.currentTarget;
    setCrop(centerAspectCrop(width, height, 1));
  };

  const createCroppedImage = async () => {
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
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.95);
    });
  };

  const handleUpload = async () => {
    if (!imgRef.current || !crop) {
      setError("Сначала выберите и обрежьте изображение");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { token } = getLocalStorageData();
      if (!token) {
        throw new Error("Токен авторизации не найден");
      }

      const croppedImageBlob = await createCroppedImage();
      if (!croppedImageBlob) {
        throw new Error("Не удалось обрезать изображение");
      }

      const formData = new FormData();
      formData.append(fieldName, croppedImageBlob, "profile.jpg");

      const response = await fetch(uploadUrl, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Загрузка не удалась");
      }

      const data = await response.json();
      onChange?.(
        `${import.meta.env.VITE_API_ADDRESS}/uploads/${data.profileImagePath}`,
      );

      handleClose();
    } catch (err) {
      console.error("Avatar upload error:", err);
      setError(err.message || "Что-то пошло не так, попробуйте ещё раз");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="avatar-upload"
        onClick={() => inputRef.current?.click()}
        aria-label={label}
      >
        <span
          className={avatarClass}
          style={avatarStyle}
          role="img"
          aria-label={alt}
        />
        <span className="avatar-upload__overlay">
          <RiCameraLine />
          <span>{label}</span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        hidden
      />

      <Modal show={show} onHide={handleClose} centered>
        <Modal.Header closeButton>
          <Modal.Title>Выберите область для загрузки</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <div className="alert alert-danger">{error}</div>}
          {imgSrc && (
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
                style={{ maxWidth: "100%" }}
              />
            </ReactCrop>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose}>
            Закрыть
          </Button>
          <Button onClick={handleUpload} disabled={!imgSrc || !crop || loading}>
            {loading ? (
              <>
                <span
                  className="spinner-border spinner-border-sm me-2"
                  role="status"
                  aria-hidden="true"
                />
                Загружаю...
              </>
            ) : (
              "Загрузить"
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

export default AvatarUpload;
