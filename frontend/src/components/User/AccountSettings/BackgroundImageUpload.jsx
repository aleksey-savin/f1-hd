import { useState } from "react";
import { getLocalStorageData } from "../../../util/auth";

import Image from "react-bootstrap/Image";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/esm/Button";

function BackgroundImageUpload({ user }) {
  const { token } = getLocalStorageData();

  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(
    user.backgroundImagePath
      ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${user.backgroundImagePath}`
      : null,
  );
  const [hasBackground, setHasBackground] = useState(
    !!user.backgroundImagePath,
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileSelect = (event) => {
    const file = event.target.files[0];

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/gif"];
    if (file && !validTypes.includes(file.type)) {
      setError("Пожалуйста, выберите файл с изображением (jpg, png, gif)");
      return;
    }

    // Validate file size
    if (file && file.size > 5 * 1024 * 1024) {
      setError("Размер файла не должен превышать 5Мб");
      return;
    }

    setError(null);
    setSelectedFile(file);

    // Create preview
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Пожалуйста, сначала выберите изображение для загрузки");
      return;
    }

    const formData = new FormData();
    formData.append("backgroundImage", selectedFile);

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/users/add-background-image`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Загрузка не удалась");
      }
      setHasBackground(true);
    } catch (error) {
      console.error("Error:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/users/delete-background-image`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Не удалось удалить изображение");
      }

      setPreviewUrl("");
      setHasBackground(false);
    } catch (error) {
      console.error("Error:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      <Row className="mb-3">
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
        <Col sm="auto">
          <Button onClick={handleUpload} disabled={!selectedFile || loading}>
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
        </Col>
        <Col>
          {!!previewUrl && hasBackground && (
            <Button variant="danger" onClick={handleDelete} disabled={loading}>
              {loading ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    role="status"
                    aria-hidden="true"
                  ></span>
                  Удаляю...
                </>
              ) : (
                "Удалить"
              )}
            </Button>
          )}
        </Col>
      </Row>
      {previewUrl && (
        <Row>
          <Col>
            <Image
              src={previewUrl}
              alt="Превью"
              thumbnail
              className="mb-3"
              style={{ maxWidth: "350px" }}
            />
          </Col>
        </Row>
      )}
    </>
  );
}

export default BackgroundImageUpload;
