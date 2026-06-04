import { useContext, useEffect, useRef } from "react";

import Viewer from "@toast-ui/editor/viewer";
import "@toast-ui/editor/dist/toastui-editor-viewer.css";
import "@toast-ui/editor/dist/theme/toastui-editor-dark.css";

import { ThemeContext } from "../store/theme-context";

// Рендер Markdown в режиме чтения. Toast UI санитизирует HTML встроенно.
const MarkdownViewer = ({ value = "" }) => {
  const elRef = useRef(null);
  const { isDark } = useContext(ThemeContext);

  useEffect(() => {
    const viewer = new Viewer({
      el: elRef.current,
      theme: isDark ? "dark" : "default",
      initialValue: value || "",
      usageStatistics: false,
    });

    return () => viewer.destroy();
  }, [value, isDark]);

  return <div ref={elRef} />;
};

export default MarkdownViewer;
