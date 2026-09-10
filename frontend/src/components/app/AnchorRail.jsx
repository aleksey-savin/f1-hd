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
// Пункт секции с `dirty: true` получает точку «не сохранено» — тот же маркер,
// что у метки секции (страницы настроек, app/draft-context).
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
        "sticky top-28 flex w-48 flex-none flex-col gap-0.5",
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
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-base font-medium no-underline transition-colors",
            active === section.id
              ? "bg-primary/15 text-accent-text hover:text-accent-text"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {section.label}
          {section.dirty && (
            <>
              <span
                aria-hidden="true"
                className="ms-auto size-1.5 flex-none rounded-full bg-warning"
              />
              <span className="sr-only">не сохранено</span>
            </>
          )}
        </a>
      ))}
    </nav>
  );
};

export default AnchorRail;
