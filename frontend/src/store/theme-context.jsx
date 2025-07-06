import { createContext, useState, useEffect } from "react";
import { getSystemTheme } from "../util/theme";

export const ThemeContext = createContext({
  theme: "system",
  isDark: false,
  setTheme: () => {},
});

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "system");

  const calculateIsDark = (currentTheme) => {
    if (currentTheme === "system") {
      return getSystemTheme() === "dark";
    }
    return currentTheme === "dark";
  };

  const [isDark, setIsDark] = useState(calculateIsDark(theme));

  const updateTheme = (newTheme) => {
    setTheme(newTheme);
    const newIsDark = calculateIsDark(newTheme);
    setIsDark(newIsDark);
    localStorage.setItem("theme", newTheme);
    localStorage.setItem("darkMode", newIsDark);
  };

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleSystemThemeChange = () => {
      if (theme === "system") {
        setIsDark(getSystemTheme() === "dark");
      }
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () =>
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, isDark, setTheme: updateTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
