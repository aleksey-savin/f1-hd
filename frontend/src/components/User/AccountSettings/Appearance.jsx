import { useContext } from "react";

import SettingRow from "@/components/app/SettingRow";
import ThemeSegment from "@/components/app/ThemeSegment";
import { ThemeContext } from "../../../store/theme-context";
import BackgroundImageUpload from "./BackgroundImageUpload";

// Секция «Внешний вид»: сегмент темы на три состояния (как в бургер-меню) и
// фоновое изображение. Кнопки «Сохранить» нет — тема применяется сразу, у
// фона своя загрузка.
const Appearance = ({ user }) => {
  const { theme, setTheme } = useContext(ThemeContext);

  const changeTheme = (value) => {
    if (value === theme) return;
    setTheme(value);
    // Легаси-CSS (bootstrap-темы) до эндшпиля миграции подхватывает
    // тему только с перезагрузкой — как при смене темы из навбара.
    window.location.reload();
  };

  return (
    <>
      <SettingRow
        title="Тема"
        hint="Применяется сразу на этом устройстве."
      >
        <ThemeSegment
          theme={theme}
          onChange={changeTheme}
          className="tw:max-md:flex"
        />
      </SettingRow>
      <SettingRow
        divider
        title="Фоновое изображение"
        hint="Показывается за панелями главного экрана. JPG, PNG или GIF, до 5 МБ."
        className="tw:items-start"
      >
        <BackgroundImageUpload user={user} />
      </SettingRow>
    </>
  );
};

export default Appearance;
