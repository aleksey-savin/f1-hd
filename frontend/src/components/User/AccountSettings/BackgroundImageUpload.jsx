import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import useRefreshRoute from "@/components/app/use-refresh-route";
import useToastStore from "../../../store/toast-store";

// Фоновое изображение рабочего стола: превью + «Загрузить»/«Удалить».
// Выбранный файл загружается сразу (валидация типа и размера — до запроса);
// превью после загрузки — серверный путь из ответа.
function BackgroundImageUpload({ user }) {
  const { showToast } = useToastStore();

  const refresh = useRefreshRoute();
  const fileInputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(
    user.backgroundImagePath
      ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${user.backgroundImagePath}`
      : null,
  );
  // Какое действие идёт сейчас: общий флаг подписывал «Загружаю…» на кнопке
  // загрузки, когда на самом деле шло удаление
  const [busy, setBusy] = useState(null);

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

    setBusy("upload");

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
      // Обои рисует оболочка из данных загрузчика корня, а не эта секция:
      // без обновления новый фон появлялся только после перезагрузки страницы
      refresh();
    } catch (error) {
      console.error("Error:", error);
      showToast("danger", error.message);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setBusy("delete");

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
      refresh();
    } catch (error) {
      console.error("Error:", error);
      showToast("danger", error.message);
    } finally {
      setBusy(null);
    }
  };

  // Кнопки — под превью и прижаты к концу строки: колонка сетки шириной с
  // превью, кнопки в её правом краю. На узком экране они делят ширину поровну.
  return (
    <div className="grid gap-2.5">
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
      <div className="flex justify-end gap-2 max-md:[&>button]:flex-1">
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
          disabled={Boolean(busy)}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy === "upload" ? "Загружаю…" : "Загрузить"}
        </Button>
        {previewUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={Boolean(busy)}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleDelete}
          >
            {busy === "delete" ? "Удаляю…" : "Удалить"}
          </Button>
        )}
      </div>
    </div>
  );
}

export default BackgroundImageUpload;
