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

  const changeTheme = (value) => setTheme(value);

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
