import React, { useState, useRef } from "react";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { getLocalStorageData } from "../../util/auth";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";

function ImageUpload({ userId, setProfileImage }) {
  const [imgSrc, setImgSrc] = useState("");
  const [crop, setCrop] = useState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const imgRef = useRef(null);

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

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/gif"];
    if (!validTypes.includes(file.type)) {
      setError("Пожалуйста, выберите файл с изображением (jpg, png, gif)");
      return;
    }

    // Validate file size
    if (file.size > 5 * 1024 * 1024) {
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

    // Get the scale of the image shown vs its natural size
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    // Set the canvas size to match the desired crop size
    canvas.width = crop.width * scaleX;
    canvas.height = crop.height * scaleY;

    ctx.drawImage(
      image,
      crop.x * scaleX, // source x
      crop.y * scaleY, // source y
      crop.width * scaleX, // source width
      crop.height * scaleY, // source height
      0, // dest x
      0, // dest y
      canvas.width, // dest width
      canvas.height, // dest height
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
        `${import.meta.env.VITE_ADDRESS}/api/users/${userId}/add-profile-image`,
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

  const [show, setShow] = useState(false);

  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);

  return (
    <>
      <Row>
        <Col sm="auto">
          <input
            type="file"
            className="form-control mb-1"
            accept="image/*"
            onChange={handleFileSelect}
          />
          <small className="text-muted">Максимальный размер файла: 5Мб</small>
          <br />
          <small className="text-muted">
            Поддерживаемые форматы: JPG, PNG, GIF
          </small>
        </Col>
        <Col sm="auto" className="pt-2">
          {error && <p className="text-danger">{error}</p>}
        </Col>
      </Row>
      <Modal show={show} onHide={handleClose} centered>
        <Modal.Header closeButton>
          <Modal.Title>Выберите область для загрузки</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ReactCrop
            crop={crop}
            onChange={(pixelCrop) => setCrop(pixelCrop)}
            aspect={1}
            circularCrop
            unit="px" // Changed to px instead of percentage
          >
            <img
              ref={imgRef}
              alt="Crop me"
              src={imgSrc}
              onLoad={onImageLoad}
              style={{ maxWidth: "100%" }}
            />
          </ReactCrop>
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
                ></span>
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

export default ImageUpload;
