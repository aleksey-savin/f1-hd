import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import useToastStore from "../../../store/toast-store";

import { getLocalStorageData } from "../../../util/auth";

// Фоновое изображение рабочего стола: превью + «Загрузить»/«Удалить».
// Выбранный файл загружается сразу (валидация типа и размера — до запроса);
// превью после загрузки — серверный путь из ответа.
function BackgroundImageUpload({ user }) {
  const { token } = getLocalStorageData();
  const { showToast } = useToastStore();

  const fileInputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(
    user.backgroundImagePath
      ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${user.backgroundImagePath}`
      : null,
  );
  const [loading, setLoading] = useState(false);

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0];
    // сбрасываем value, чтобы повторный выбор того же файла снова сработал
    event.target.value = "";
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

    const formData = new FormData();
    formData.append("backgroundImage", file);

    setLoading(true);

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

      const data = await response.json();
      setPreviewUrl(
        `${import.meta.env.VITE_API_ADDRESS}/uploads/${data.backgroundImagePath}`,
      );
      showToast("success", "Фоновое изображение обновлено");
    } catch (error) {
      console.error("Error:", error);
      showToast("danger", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);

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

      setPreviewUrl(null);
      showToast("success", "Фоновое изображение удалено");
    } catch (error) {
      console.error("Error:", error);
      showToast("danger", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tw:grid tw:justify-items-start tw:gap-2.5 tw:max-md:justify-items-stretch">
      {previewUrl ? (
        // div с background-image, а не <img>: глобальный автоскейл картинок
        // тикетов (index.css: img { width/height: auto !important }) ломает
        // фиксированные размеры любых <img>
        <div
          role="img"
          aria-label="Превью фонового изображения"
          style={{ backgroundImage: `url("${previewUrl}")` }}
          className="tw:h-32 tw:w-56 tw:rounded-lg tw:border tw:border-border tw:bg-cover tw:bg-center tw:max-md:h-40 tw:max-md:w-full"
        />
      ) : (
        <div className="tw:grid tw:h-32 tw:w-56 tw:place-items-center tw:rounded-lg tw:border tw:border-dashed tw:border-input tw:text-sm tw:text-faint tw:max-md:h-40 tw:max-md:w-full">
          Не задано
        </div>
      )}
      <div className="tw:flex tw:gap-2">
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
          disabled={loading}
          onClick={() => fileInputRef.current?.click()}
        >
          {loading ? "Загружаю…" : "Загрузить"}
        </Button>
        {previewUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            className="tw:text-destructive tw:hover:bg-destructive/10 tw:hover:text-destructive"
            onClick={handleDelete}
          >
            Удалить
          </Button>
        )}
      </div>
    </div>
  );
}

export default BackgroundImageUpload;
