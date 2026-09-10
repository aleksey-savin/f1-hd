import { useContext, useState } from "react";
import { useRevalidator } from "react-router";

import Combobox from "@/components/app/Combobox";
import Segmented from "@/components/app/Segmented";
import SettingRow from "@/components/app/SettingRow";
import ThemeSegment from "@/components/app/ThemeSegment";
import { API } from "@/pages/Auth/session";
import useToastStore from "@/store/toast-store";
import timezones from "@/store/timezones";
import { orgTimezone, tzCity } from "@/util/timezone-display";
import { ThemeContext } from "../../../store/theme-context";
import BackgroundImageUpload from "./BackgroundImageUpload";

// Секция «Внешний вид»: сегмент темы на три состояния (как в бургер-меню),
// размер текста, часовой пояс показа, вид канвы и фоновое изображение.
// Кнопки «Сохранить» нет — всё применяется сразу, у фона своя загрузка.

const FONT_SCALE_OPTIONS = [
  { value: "100", label: "Обычный" },
  { value: "125", label: "Крупный" },
];

const CANVAS_OPTIONS = [
  { value: "textured", label: "Клетка" },
  { value: "plain", label: "Чистый" },
];

const Appearance = ({ user }) => {
  const {
    theme,
    setTheme,
    fontScale,
    setFontScale,
    plainCanvas,
    setPlainCanvas,
  } = useContext(ThemeContext);
  const { showToast } = useToastStore();
  const [savingScale, setSavingScale] = useState(false);
  const [savingCanvas, setSavingCanvas] = useState(false);
  const [timezone, setTimezone] = useState(user.timezone || null);
  const [savingTimezone, setSavingTimezone] = useState(false);
  const revalidator = useRevalidator();

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

  /**
   * Вид канвы — такая же личная настройка, как масштаб, и живёт по тем же
   * правилам: применяется сразу (провайдер ставит атрибут на <html>), сервер
   * запоминает выбор, не сохранилось — откатываем.
   */
  const changeCanvas = async (value) => {
    const next = value === "plain";
    if (next === plainCanvas) return;
    setPlainCanvas(next);
    setSavingCanvas(true);
    try {
      const response = await fetch(`${API}/api/users/update-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plainCanvas: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      setPlainCanvas(!next);
      showToast("danger", "Вид канвы не сохранился. Попробуйте ещё раз.");
    } finally {
      setSavingCanvas(false);
    }
  };

  /**
   * Часовой пояс показа. Настройка УДОБСТВА: она меняет только то, в каком
   * поясе человек читает даты, и ни на одну цифру не влияет — расчёты сервер
   * ведёт в поясе организации и присылает периоды готовыми строками.
   * Пусто — как в организации.
   */
  const changeTimezone = async (value) => {
    const next = value || null;
    if (next === timezone) return;
    const previous = timezone;
    setTimezone(next);
    setSavingTimezone(true);
    try {
      const response = await fetch(`${API}/api/users/update-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ timezone: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      // Пояс читает util/format-date из localStorage при каждом форматировании;
      // зеркало обновляет загрузчик корня — просим его перечитать данные,
      // иначе даты переедут только после перезагрузки страницы.
      revalidator.revalidate();
    } catch {
      setTimezone(previous);
      showToast("danger", "Часовой пояс не сохранился. Попробуйте ещё раз.");
    } finally {
      setSavingTimezone(false);
    }
  };

  return (
    <>
      <SettingRow title="Тема" >
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
        title="Часовой пояс"
        htmlFor="account-timezone"
      >
        <div className="w-72 max-md:w-full">
          <Combobox
            id="account-timezone"
            options={timezones}
            value={timezone}
            onChange={changeTimezone}
            disabled={savingTimezone}
            clearable
            clearLabel={`Как в организации — ${tzCity(orgTimezone())}`}
            placeholder={`Как в организации — ${tzCity(orgTimezone())}`}
            searchPlaceholder="Город или зона…"
          />
        </div>
      </SettingRow>
      <SettingRow
        divider
        title="Фон приложения"
        hint="«Клетка» — мелкая клетка на канве и панели страниц на подложке."
      >
        <Segmented
          ariaLabel="Фон приложения"
          options={CANVAS_OPTIONS}
          value={plainCanvas ? "plain" : "textured"}
          onChange={changeCanvas}
          disabled={savingCanvas}
          className="max-md:flex"
        />
      </SettingRow>
      <SettingRow
        divider
        title="Фоновое изображение"
        hint={
          plainCanvas
            ? "Показывается за панелями главного экрана. Сейчас скрыто: выбран чистый фон."
            : "Показывается за панелями главного экрана. JPG, PNG или GIF, до 5 МБ."
        }
        className="items-start"
      >
        <BackgroundImageUpload user={user} />
      </SettingRow>
    </>
  );
};

export default Appearance;
