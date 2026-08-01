import { useState, useEffect } from "react";
import { isBrowser } from "react-device-detect";
import { RiArrowUpLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";

/**
 * Круглая кнопка «наверх» у нижнего правого угла — только десктоп.
 *
 * На мобайле её нет вовсе: там скроллится `.mobile-shell__scroll`, а не window
 * (см. «Мобильная навигация» в docs/ux-ui-guide.md), и слушать window
 * бессмысленно. Гейт стоит и на подписке, и на отрисовке.
 *
 * z-index — легаси-шкала оболочки: выше бара (1030), ниже radix-оверлеев
 * (1100). Встроенная сетка tw заканчивается на 50, поэтому значение инлайном —
 * как у бара в layout/Root.jsx.
 */
const BackToTop = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isBrowser) return;

    const toggleVisibility = () => setIsVisible(window.scrollY > 300);

    window.addEventListener("scroll", toggleVisibility);
    return () => window.removeEventListener("scroll", toggleVisibility);
  }, []);

  if (!isBrowser || !isVisible) return null;

  return (
    <Button
      size="icon-lg"
      aria-label="Наверх"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed right-5 bottom-5 rounded-full shadow-lg"
      style={{ zIndex: 1040 }}
    >
      <RiArrowUpLine className="size-5" />
    </Button>
  );
};

export default BackToTop;
