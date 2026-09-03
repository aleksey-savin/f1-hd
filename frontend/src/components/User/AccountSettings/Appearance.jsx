import { useContext, useState } from "react";

import Segmented from "@/components/app/Segmented";
import SettingRow from "@/components/app/SettingRow";
import ThemeSegment from "@/components/app/ThemeSegment";
import { API } from "@/pages/Auth/session";
import useToastStore from "@/store/toast-store";
import { ThemeContext } from "../../../store/theme-context";
import BackgroundImageUpload from "./BackgroundImageUpload";

// Секция «Внешний вид»: сегмент темы на три состояния (как в бургер-меню),
// размер текста и фоновое изображение. Кнопки «Сохранить» нет — тема и
// размер применяются сразу, у фона своя загрузка.

const FONT_SCALE_OPTIONS = [
  { value: "100", label: "Обычный" },
  { value: "125", label: "Крупный" },
];

const Appearance = ({ user }) => {
  const { theme, setTheme, fontScale, setFontScale } = useContext(ThemeContext);
  const { showToast } = useToastStore();
  const [savingScale, setSavingScale] = useState(false);

  const changeTheme = (value) => setTheme(value);

  /**
   * Размер текста — личная настройка, не настройка устройства: применяем
   * сразу (контекст ставит атрибут на <html>), а сервер запоминает выбор,
   * чтобы он приехал на другое устройство. Не сохранилось — откатываем,
   * иначе экран показывал бы то, чего сервер не помнит.
   */
  const changeFontScale = async (value) => {
    const next = Number(value);
    if (next === fontScale) return;
    const previous = fontScale;
    setFontScale(next);
    setSavingScale(true);
    try {
      const response = await fetch(`${API}/api/users/update-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fontScale: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      setFontScale(previous);
      showToast("danger", "Размер текста не сохранился. Попробуйте ещё раз.");
    } finally {
      setSavingScale(false);
    }
  };

  return (
    <>
      <SettingRow title="Тема" hint="Применяется сразу на этом устройстве.">
        <ThemeSegment
          theme={theme}
          onChange={changeTheme}
          className="max-md:flex"
        />
      </SettingRow>
      <SettingRow
        divider
        title="Размер текста"
        hint="Крупный — на четверть больше обычного. Действует на компьютере; на телефоне размер не меняется."
      >
        <Segmented
          ariaLabel="Размер текста"
          options={FONT_SCALE_OPTIONS}
          value={String(fontScale)}
          onChange={changeFontScale}
          disabled={savingScale}
          className="max-md:flex"
        />
      </SettingRow>
      <SettingRow
        divider
        title="Фоновое изображение"
        hint="Показывается за панелями главного экрана. JPG, PNG или GIF, до 5 МБ."
        className="items-start"
      >
        <BackgroundImageUpload user={user} />
      </SettingRow>
    </>
  );
};

export default Appearance;
