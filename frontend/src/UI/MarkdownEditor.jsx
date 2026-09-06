import { useContext, useEffect, useRef } from "react";

import { ThemeContext } from "../store/theme-context";

// Тонкая обёртка над ванильным Toast UI Editor (markdown-нативный редактор).
// Ванильный пакет не зависит от React, поэтому совместим с React 19 (в отличие
// от устаревшей @toast-ui/react-editor).
//
// Пакет и его css грузятся ДИНАМИЧЕСКИ, в момент монтирования: редактор — самая
// тяжёлая зависимость приложения, а нужен на четырёх экранах (заявка, шаблон,
// регламент, заметка базы знаний). Статический импорт клал его в главный чанк,
// который грузят все, включая клиента с одной заявкой.
//
// Формат наружу выбирает вызывающий:
//   "markdown" (по умолчанию) — база знаний, шаблон заявки, регламент;
//   "html" — описание заявки. Оно остаётся HTML не по привычке: на html-строке
//   работают подсветка понятий и метка ИИ (View/TicketTerms), карточка выводит
//   его через dangerouslySetInnerHTML, а «Оригинал письма» лежит в соседнем
//   htmlDescription. Из 3375 заявок за год html-разметку несут все 314 заявок
//   из регламентов и 949 из 1141 портальных.
const MarkdownEditor = ({
  initialValue = "",
  onChange,
  onReady,
  height = "500px",
  // Скрыть вкладки Markdown/WYSIWYG снизу — редактор остаётся только WYSIWYG.
  hideModeSwitch = false,
  format = "markdown",
}) => {
  const isHtml = format === "html";
  const elRef = useRef(null);
  const editorRef = useRef(null);
  const { isDark } = useContext(ThemeContext);

  // Держим актуальные колбэки без пересоздания редактора
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    // Размонтирование может обогнать загрузку чанка — тогда создавать редактор
    // уже некуда и незачем.
    let cancelled = false;

    (async () => {
      const [module] = await Promise.all([
        import("@toast-ui/editor"),
        import("@toast-ui/editor/dist/toastui-editor.css"),
        import("@toast-ui/editor/dist/theme/toastui-editor-dark.css"),
      ]);
      if (cancelled || !elRef.current) return;

      const Editor = module.default ?? module;
      const editor = new Editor({
        el: elRef.current,
        height,
        theme: isDark ? "dark" : "default",
        initialEditType: "wysiwyg",
        previewStyle: "vertical",
        hideModeSwitch,
        usageStatistics: false,
        autofocus: false,
        // В html-режиме initialValue отдаём отдельно: initialValue конструктора
        // трактуется как markdown, и готовая разметка приехала бы в редактор
        // текстом с тегами.
        initialValue: isHtml ? "" : initialValue || "",
        toolbarItems: [
          ["heading", "bold", "italic", "strike"],
          ["hr", "quote"],
          ["ul", "ol", "task"],
          ["table", "link"],
          ["code", "codeblock"],
        ],
      });

      if (isHtml && initialValue) editor.setHTML(initialValue, false);

      editor.on("change", () => {
        onChangeRef.current?.(isHtml ? editor.getHTML() : editor.getMarkdown());
      });

      editorRef.current = editor;
      // Отдаём инстанс наружу: вызывающий код фокусирует редактор и прокручивает
      // его к нужному блоку (вход в правку двойным кликом по тексту).
      onReadyRef.current?.(editor);
    })();

    return () => {
      cancelled = true;
      editorRef.current?.destroy();
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
  // min-height равна итоговой высоте: Toast UI ставит `height` на этот же
  // элемент, поэтому место под редактор занято ещё до приезда ленивого чанка —
  // шторка формы не подрастает вторым движением.
  return (
    <div
      ref={elRef}
      style={
        height === "auto" ? undefined : { height: "100%", minHeight: height }
      }
    />
  );
};

export default MarkdownEditor;
