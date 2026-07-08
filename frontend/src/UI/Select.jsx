import BaseSelect from "react-select";
import FixRequiredSelect from "../util/fix-required-select";
import { getLocalStorageData } from "../util/auth";
import useSystemTheme from "../hooks/useSystemTheme";

const darkThemeStyles = {
  option: (provided, state) => ({
    ...provided,
    backgroundColor: state.isSelected
      ? "rgb(52, 152, 219)"
      : state.isFocused
        ? "#ced4da"
        : "white",
    color: state.isSelected ? "rgb(34, 34, 34)" : "rgb(34, 34, 34)",
    "&:hover": {
      backgroundColor: "#ced4da",
    },
  }),
  control: (provided) => ({
    ...provided,
    borderColor: "rgb(235, 235, 235)",
  }),
};

// На тач-устройствах меню нельзя рендерить в fixed-портал: при открытии
// экранной клавиатуры iOS доскролливает контейнер формы к сфокусированному
// полю, а спозиционированное заранее меню остаётся на старых координатах и
// «повисает» возле другого селекта. Инлайн-меню скроллится вместе с формой.
const isTouchDevice =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

const Select = (props) => {
  const { theme } = getLocalStorageData();
  const isSystemDark = useSystemTheme();

  let darkMode =
    theme === "dark" ? true : theme === "system" ? isSystemDark : false;

  // На десктопе меню рендерим в портал на <body> с высоким z-index, иначе
  // соседние элементы со своим stacking context (напр. Markdown-редактор)
  // перекрывают выпадающий список. Для инлайн-меню ту же проблему решает
  // z-index больше, чем у Toast UI (у него максимум 40).
  const styles = {
    ...(darkMode ? darkThemeStyles : {}),
    menuPortal: (provided) => ({ ...provided, zIndex: 9999 }),
    menu: (provided) => ({ ...provided, zIndex: 100 }),
  };

  return (
    <FixRequiredSelect
      menuPlacement="auto"
      {...(isTouchDevice ? {} : { menuPosition: "fixed" })}
      {...props}
      SelectComponent={BaseSelect}
      menuPortalTarget={
        !isTouchDevice && typeof document !== "undefined"
          ? document.body
          : undefined
      }
      styles={styles}
      options={props.options}
      theme={(theme) =>
        darkMode
          ? {
              ...theme,
              colors: {
                ...theme.colors,
                primary25: "rgb(235, 235, 235)",
                primary: "rgb(235, 235, 235)",
              },
            }
          : {
              ...theme,
              colors: {
                ...theme.colors,
                primary: "#2c3e50",
                primary25: "#ced4da",
              },
            }
      }
    />
  );
};

export default Select;
