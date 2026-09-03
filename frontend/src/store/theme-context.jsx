import { createContext, useState, useEffect, useLayoutEffect } from "react";
import { getSystemTheme } from "../util/theme";

/** Допустимые значения личного масштаба интерфейса, проценты. */
export const FONT_SCALES = [100, 125];

const readFontScale = () => {
  const stored = Number(localStorage.getItem("fontScale"));
  return FONT_SCALES.includes(stored) ? stored : 100;
};

export const ThemeContext = createContext({
  theme: "system",
  isDark: false,
  setTheme: () => {},
  fontScale: 100,
  setFontScale: () => {},
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

  /**
   * Масштаб текста — ЛИЧНАЯ настройка, а не настройка устройства (в отличие
   * от темы): хранится на сервере (`user.fontScale`) и следует за человеком.
   * localStorage здесь — зеркало для первой отрисовки и экранов входа, где
   * `/api/me` ещё нет; после загрузки корня сервер побеждает (layout/Root).
   */
  const [fontScale, setFontScaleState] = useState(readFontScale);

  const updateFontScale = (next) => {
    const value = FONT_SCALES.includes(Number(next)) ? Number(next) : 100;
    setFontScaleState(value);
    localStorage.setItem("fontScale", String(value));
  };

  // Класс .dark на <html> — источник тёмной темы для tailwind/shadcn-токенов
  // (см. @custom-variant dark в styles/tailwind.css). Держим синхронно с
  // isDark.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // Атрибут на <html>, а не inline font-size: применяет ли масштаб этот экран,
  // решает CSS (только десктоп — правило в styles/tailwind.css).
  useLayoutEffect(() => {
    document.documentElement.dataset.fontScale = String(fontScale);
  }, [fontScale]);

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
    <ThemeContext.Provider
      value={{
        theme,
        isDark,
        setTheme: updateTheme,
        fontScale,
        setFontScale: updateFontScale,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};
