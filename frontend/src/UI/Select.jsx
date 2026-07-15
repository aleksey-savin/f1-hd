import { useContext } from "react";
import BaseSelect from "react-select";
import FixRequiredSelect from "../util/fix-required-select";
import { InsideOverlayContext } from "@/components/app/overlay-context";

// Стили целиком на css-переменных новой темы (src/styles/tailwind.css):
// светлая/тёмная переключаются классом .dark на <html> сами, без чтения темы
// в JS. Заодно починено нечитаемое светлое меню в тёмной теме.
const styles = {
  control: (provided, state) => ({
    ...provided,
    backgroundColor: "var(--card)",
    borderColor: state.isFocused ? "var(--ring)" : "var(--input)",
    boxShadow: state.isFocused
      ? "0 0 0 3px color-mix(in srgb, var(--ring) 30%, transparent)"
      : "none",
    "&:hover": {
      borderColor: "var(--ring)",
    },
  }),
  valueContainer: (provided) => ({
    ...provided,
    color: "var(--foreground)",
  }),
  singleValue: (provided) => ({
    ...provided,
    color: "var(--foreground)",
  }),
  input: (provided) => ({
    ...provided,
    color: "var(--foreground)",
  }),
  placeholder: (provided) => ({
    ...provided,
    color: "var(--muted-foreground)",
  }),
  // Меню в портале на <body> с высоким z-index, иначе соседние элементы со
  // своим stacking context (напр. Markdown-редактор) перекрывают список. Для
  // инлайн-меню ту же проблему решает z-index больше, чем у Toast UI (max 40).
  menuPortal: (provided) => ({ ...provided, zIndex: 9999 }),
  menu: (provided) => ({
    ...provided,
    zIndex: 100,
    backgroundColor: "var(--popover)",
    border: "1px solid var(--border)",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
  }),
  option: (provided, state) => ({
    ...provided,
    backgroundColor: state.isSelected
      ? "var(--primary)"
      : state.isFocused
        ? "var(--accent)"
        : "transparent",
    color: state.isSelected
      ? "var(--primary-foreground)"
      : "var(--popover-foreground)",
    "&:active": {
      backgroundColor: "var(--accent)",
    },
  }),
  multiValue: (provided) => ({
    ...provided,
    backgroundColor: "var(--accent)",
  }),
  multiValueLabel: (provided) => ({
    ...provided,
    color: "var(--accent-foreground)",
  }),
  multiValueRemove: (provided) => ({
    ...provided,
    color: "var(--muted-foreground)",
    "&:hover": {
      backgroundColor: "var(--destructive)",
      color: "var(--destructive-foreground)",
    },
  }),
  indicatorSeparator: (provided) => ({
    ...provided,
    backgroundColor: "var(--border)",
  }),
  dropdownIndicator: (provided) => ({
    ...provided,
    color: "var(--muted-foreground)",
    "&:hover": { color: "var(--foreground)" },
  }),
  clearIndicator: (provided) => ({
    ...provided,
    color: "var(--muted-foreground)",
    "&:hover": { color: "var(--destructive)" },
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
  // Внутри модального radix-оверлея (FormSheet/фильтр-Sheet/Dialog) портал в
  // body некликабелен (pointer-events: none) и pointerdown по нему закрывает
  // шторку — там меню рендерим инлайн, как на тач-устройствах.
  const insideOverlay = useContext(InsideOverlayContext);
  const inlineMenu = isTouchDevice || insideOverlay;

  return (
    <FixRequiredSelect
      menuPlacement="auto"
      {...(inlineMenu ? {} : { menuPosition: "fixed" })}
      {...props}
      SelectComponent={BaseSelect}
      menuPortalTarget={
        !inlineMenu && typeof document !== "undefined"
          ? document.body
          : undefined
      }
      styles={styles}
      options={props.options}
    />
  );
};

export default Select;
