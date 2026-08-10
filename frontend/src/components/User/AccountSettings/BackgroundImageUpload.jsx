import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import useToastStore from "../../../store/toast-store";


// Фоновое изображение рабочего стола: превью + «Загрузить»/«Удалить».
// Выбранный файл загружается сразу (валидация типа и размера — до запроса);
// превью после загрузки — серверный путь из ответа.
function BackgroundImageUpload({ user }) {
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
      showToast("danger", "Размер файла не должен превышать 5 МБ");
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
    <div className="grid justify-items-start gap-2.5 max-md:justify-items-stretch">
      {previewUrl ? (
        // div с background-image, а не <img>: глобальный автоскейл картинок
        // тикетов (index.css: img { width/height: auto !important }) ломает
        // фиксированные размеры любых <img>
        <div
          role="img"
          aria-label="Превью фонового изображения"
          style={{ backgroundImage: `url("${previewUrl}")` }}
          className="h-32 w-56 rounded-lg border border-border bg-cover bg-center max-md:h-40 max-md:w-full"
        />
      ) : (
        <div className="grid h-32 w-56 place-items-center rounded-lg border border-dashed border-input text-sm text-faint max-md:h-40 max-md:w-full">
          Не задано
        </div>
      )}
      <div className="flex gap-2">
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
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
