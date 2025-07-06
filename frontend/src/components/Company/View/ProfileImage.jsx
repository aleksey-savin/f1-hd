import { useState, useRef } from "react";
import { Image, Modal, Button } from "react-bootstrap";
import { BiUpload } from "react-icons/bi";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { getLocalStorageData } from "../../../util/auth";

import "../../../css/ProfileImage.css";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif"];

const ProfileImage = ({ companyId, initialImage }) => {
  const [profileImage, setProfileImage] = useState(
    initialImage || "/companypic-placeholder.png",
  );
  const [imgSrc, setImgSrc] = useState("");
  const [crop, setCrop] = useState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [show, setShow] = useState(false);

  const imgRef = useRef(null);

  const handleClose = () => {
    setShow(false);
    setImgSrc("");
    setCrop(undefined);
    setError(null);
  };

  const handleShow = () => setShow(true);

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
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Пожалуйста, выберите файл с изображением (jpg, png, gif)");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError("Размер файла не должен превышать 5Мб");
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setImgSrc(reader.result?.toString() || "");
      handleShow();
    });
    reader.readAsDataURL(file);
  };

  const onImageLoad = (e) => {
    const { width, height } = e.currentTarget;
    const crop = centerAspectCrop(width, height, 1);
    setCrop(crop);
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
      setError("Please select and crop an image first!");
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
        `${import.meta.env.VITE_ADDRESS}/api/companies/${companyId}/add-profile-image`,
        {
          method: "PATCH",
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
        `${import.meta.env.VITE_ADDRESS}/uploads/${data.profileImagePath}`,
      );

      handleClose();
    } catch (error) {
      console.error("Error:", error);
      setError(error.message || "Что-то пошло не так, попробуйте ещё раз");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="profile-image-container">
        <Image
          src={profileImage}
          roundedCircle
          style={{ maxWidth: "15rem" }}
          className="profile-image"
        />
        <label className="profile-image-overlay" htmlFor="profile-image-input">
          <BiUpload size={24} />
          <span>Изменить фото</span>
        </label>
        <input
          id="profile-image-input"
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />
      </div>

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
                alt="Crop me"
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
};

export default ProfileImage;
