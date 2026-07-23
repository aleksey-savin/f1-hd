import { useEffect, useState } from "react";
import { isBrowser } from "react-device-detect";

import { cn } from "@/lib/utils";

// Липкий рейл-якорь для длинных страниц, где разделы идут одним скроллом
// («Мой аккаунт», карточка пользователя): ведёт по секциям и подсвечивает
// текущую. Слушатель скролла — на window и только в BrowserView: на мобайле
// window не скроллится (см. docs/ux-ui-guide.md), поэтому рейл там не рендерим.
// Якоря секций делают Eyebrow/SettingsSection/PillPanel через проп id
// (у них же scroll-mt под fixed-навбар).

// Порог scrollspy: fixed-навбар (~100px) + запас до метки секции.
const SPY_OFFSET = 140;

const AnchorRail = ({
  sections = [],
  ariaLabel = "Разделы",
  offset = SPY_OFFSET,
  className,
}) => {
  const [active, setActive] = useState(sections[0]?.id);
  // Набор секций у карточки собирается по условиям — сравниваем по составу id,
  // а не по ссылке на массив, иначе эффект пересоздавался бы каждый рендер.
  const ids = sections.map((section) => section.id).join("|");

  useEffect(() => {
    if (!isBrowser || !ids) return undefined;
    const list = ids.split("|");

    const onScroll = () => {
      // У дна страницы последние секции не доезжают до верха — активна последняя
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4
      ) {
        setActive(list[list.length - 1]);
        return;
      }
      let current = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= offset) {
          current = id;
        }
      }
      setActive(current);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [ids, offset]);

  if (sections.length === 0) return null;

  const go = (event, id) => {
    event.preventDefault();
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document.getElementById(id)?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    setActive(id);
  };

  return (
    <nav
      aria-label={ariaLabel}
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
