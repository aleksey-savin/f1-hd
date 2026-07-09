import { useContext, useEffect, useRef } from "react";

import Editor from "@toast-ui/editor";
import "@toast-ui/editor/dist/toastui-editor.css";
import "@toast-ui/editor/dist/theme/toastui-editor-dark.css";

import { ThemeContext } from "../store/theme-context";

// Тонкая обёртка над ванильным Toast UI Editor (markdown-нативный редактор).
// Источник истины — Markdown: наружу отдаём instance.getMarkdown(). Ванильный
// пакет не зависит от React, поэтому совместим с React 19 (в отличие от
// устаревшей @toast-ui/react-editor).
const MarkdownEditor = ({
  initialValue = "",
  onChange,
  onReady,
  height = "500px",
}) => {
  const elRef = useRef(null);
  const editorRef = useRef(null);
  const { isDark } = useContext(ThemeContext);

  // Держим актуальные колбэки без пересоздания редактора
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const editor = new Editor({
      el: elRef.current,
      height,
      theme: isDark ? "dark" : "default",
      initialEditType: "wysiwyg",
      previewStyle: "vertical",
      usageStatistics: false,
      autofocus: false,
      initialValue: initialValue || "",
      toolbarItems: [
        ["heading", "bold", "italic", "strike"],
        ["hr", "quote"],
        ["ul", "ol", "task"],
        ["table", "link"],
        ["code", "codeblock"],
      ],
    });

    editor.on("change", () => {
      onChangeRef.current?.(editor.getMarkdown());
    });

    editorRef.current = editor;
    // Отдаём инстанс наружу: вызывающий код фокусирует редактор и прокручивает
    // его к нужному блоку (вход в правку двойным кликом по тексту).
    onReadyRef.current?.(editor);

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // Создаём один раз: initialValue/height фиксируются при монтировании,
    // чтобы внешние ре-рендеры не сбрасывали курсор.
  }, []);

  // Переключаем тему без пересоздания редактора (иначе терялся бы курсор/ввод).
  // Тёмная тема Toast UI — это класс `toastui-editor-dark` на корне defaultUI.
  useEffect(() => {
    const ui = elRef.current?.querySelector(".toastui-editor-defaultUI");
    ui?.classList.toggle("toastui-editor-dark", isDark);
  }, [isDark]);

  // height:100% позволяет редактору заполнить flex-родителя с заданной высотой.
  // height="auto" (мобайл) — редактор растёт по содержимому, скроллит страница,
  // поэтому обёртке высоту не навязываем.
  return (
    <div ref={elRef} style={height === "auto" ? undefined : { height: "100%" }} />
  );
};

export default MarkdownEditor;
