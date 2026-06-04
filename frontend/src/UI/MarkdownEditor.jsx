import { useEffect, useRef } from "react";

import Editor from "@toast-ui/editor";
import "@toast-ui/editor/dist/toastui-editor.css";

// Тонкая обёртка над ванильным Toast UI Editor (markdown-нативный редактор).
// Источник истины — Markdown: наружу отдаём instance.getMarkdown(). Ванильный
// пакет не зависит от React, поэтому совместим с React 19 (в отличие от
// устаревшей @toast-ui/react-editor).
const MarkdownEditor = ({ initialValue = "", onChange, height = "500px" }) => {
  const elRef = useRef(null);
  const editorRef = useRef(null);

  // Держим актуальный onChange без пересоздания редактора
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const editor = new Editor({
      el: elRef.current,
      height,
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

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // Создаём один раз: initialValue/height фиксируются при монтировании,
    // чтобы внешние ре-рендеры не сбрасывали курсор.
  }, []);

  return <div ref={elRef} />;
};

export default MarkdownEditor;
