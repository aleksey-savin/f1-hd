import { useContext, useEffect, useState } from "react";
import { isBrowser } from "react-device-detect";

import { OverlayScrollContext } from "@/components/app/overlay-context";
import { cn } from "@/lib/utils";

// Липкий рейл-якорь для длинных полотен, где разделы идут одним скроллом
// («Мой аккаунт», карточка пользователя, длинная форма правки в шторке): ведёт
// по секциям и подсвечивает текущую. На мобайле не рендерим (см.
// docs/ux-ui-guide.md): там window не скроллится, а секции идут просто подряд.
// Якоря секций делают Eyebrow/SettingsSection/PillPanel через проп id
// (у них же scroll-mt под fixed-навбар); в форме якорь вешает сама секция.
//
// Скроллить может либо окно (обычная страница), либо внутренность шторки —
// её элемент приходит из OverlayScrollContext (см. app/FormSheet).

// Порог scrollspy: на странице — fixed-навбар (~100px) + запас до метки секции;
// в шторке над контентом ничего не висит.
const PAGE_OFFSET = 140;
const SHEET_OFFSET = 24;
// Зазор над секцией после перехода по якорю — чтобы метка не липла к краю
const LEAD = 8;

/**
 * Подвести секцию под верх скроллящегося контейнера (или окна).
 * Общая с рейлом механика — ею же форма отрабатывает переход по хешу.
 */
export const scrollToSection = (scroller, id, smooth = true) => {
  const element = document.getElementById(id);
  if (!element) return false;
  const behavior =
    smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "smooth"
      : "auto";
  if (scroller) {
    const delta =
      element.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: scroller.scrollTop + delta - LEAD, behavior });
  } else {
    element.scrollIntoView({ behavior, block: "start" });
  }
  return true;
};

const AnchorRail = ({
  sections = [],
  ariaLabel = "Разделы",
  offset,
  className,
  // Липкое смещение, когда над рейлом висит своя шапка (заголовок формы в
  // шторке): её высота известна только вызывающему
  style,
}) => {
  const scroller = useContext(OverlayScrollContext);
  const [active, setActive] = useState(sections[0]?.id);
  // Набор секций собирается по условиям — сравниваем по составу id, а не по
  // ссылке на массив, иначе эффект пересоздавался бы каждый рендер.
  const ids = sections.map((section) => section.id).join("|");
  const spy = offset ?? (scroller ? SHEET_OFFSET : PAGE_OFFSET);

  useEffect(() => {
    if (!isBrowser || !ids) return undefined;
    const list = ids.split("|");
    const target = scroller ?? window;

    const onScroll = () => {
      // У дна последние секции не доезжают до верха — активна последняя
      const atBottom = scroller
        ? scroller.scrollTop + scroller.clientHeight >=
          scroller.scrollHeight - 4
        : window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 4;
      if (atBottom) {
        setActive(list[list.length - 1]);
        return;
      }
      const originTop = scroller ? scroller.getBoundingClientRect().top : 0;
      let current = list[0];
      for (const id of list) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top - originTop <= spy) {
          current = id;
        }
      }
      setActive(current);
    };

    target.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => target.removeEventListener("scroll", onScroll);
  }, [ids, spy, scroller]);

  if (sections.length === 0) return null;

  const go = (event, id) => {
    event.preventDefault();
    scrollToSection(scroller, id);
    setActive(id);
  };

  return (
    <nav
      aria-label={ariaLabel}
      style={style}
      className={cn(
        "tw:sticky tw:top-28 tw:flex tw:w-48 tw:flex-none tw:flex-col tw:gap-0.5",
        className,
      )}
    >
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          onClick={(event) => go(event, section.id)}
          aria-current={active === section.id ? "true" : undefined}
          className={cn(
            "tw:rounded-lg tw:px-3 tw:py-1.5 tw:text-base tw:font-medium tw:no-underline tw:transition-colors",
            active === section.id
              ? "tw:bg-primary/15 tw:text-accent-text tw:hover:text-accent-text"
              : "tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-foreground",
          )}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
};

export default AnchorRail;
