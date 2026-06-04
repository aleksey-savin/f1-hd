import { useEffect, useRef } from "react";

import Viewer from "@toast-ui/editor/viewer";
import "@toast-ui/editor/dist/toastui-editor-viewer.css";

// Рендер Markdown в режиме чтения. Toast UI санитизирует HTML встроенно.
const MarkdownViewer = ({ value = "" }) => {
  const elRef = useRef(null);

  useEffect(() => {
    const viewer = new Viewer({
      el: elRef.current,
      initialValue: value || "",
      usageStatistics: false,
    });

    return () => viewer.destroy();
  }, [value]);

  return <div ref={elRef} />;
};

export default MarkdownViewer;
