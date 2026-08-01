import { useContext, useEffect, useRef } from "react";

import { ThemeContext } from "../store/theme-context";

// Рендер Markdown в режиме чтения. Toast UI санитизирует HTML встроенно.
// Пакет грузится динамически — см. MarkdownEditor: в главном чанке ему не место.
const MarkdownViewer = ({ value = "" }) => {
  const elRef = useRef(null);
  const { isDark } = useContext(ThemeContext);

  useEffect(() => {
    let cancelled = false;
    let viewer = null;

    (async () => {
      const [module] = await Promise.all([
        import("@toast-ui/editor/viewer"),
        import("@toast-ui/editor/dist/toastui-editor-viewer.css"),
        import("@toast-ui/editor/dist/theme/toastui-editor-dark.css"),
      ]);
      // Эффект пересоздаёт вьюер на каждое изменение value/темы: пока чанк
      // ехал, эффект мог смениться — тогда этот экземпляр уже не нужен.
      if (cancelled || !elRef.current) return;

      const Viewer = module.default ?? module;
      viewer = new Viewer({
        el: elRef.current,
        theme: isDark ? "dark" : "default",
        initialValue: value || "",
        usageStatistics: false,
      });
    })();

    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [value, isDark]);

  return <div ref={elRef} />;
};

export default MarkdownViewer;
