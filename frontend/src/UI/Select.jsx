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

const Select = (props) => {
  const { theme } = getLocalStorageData();
  const isSystemDark = useSystemTheme();

  let darkMode =
    theme === "dark" ? true : theme === "system" ? isSystemDark : false;

  return (
    <FixRequiredSelect
      {...props}
      SelectComponent={BaseSelect}
      styles={darkMode ? darkThemeStyles : ""}
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
