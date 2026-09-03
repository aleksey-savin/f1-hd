import { useContext, useEffect } from "react";
import { useLocation } from "react-router";
import { BrowserView } from "react-device-detect";

import AnchorRail, { scrollToSection } from "@/components/app/AnchorRail";
import { OverlayScrollContext } from "@/components/app/overlay-context";

// Каркас длинной формы в шторке: липкий заголовок + плоские секции с
// рейлом-якорем слева (десктоп; на мобайле секции идут подряд, как на карточке).
// Правка — всегда плоская, шаги остаются только в создании (ux-ui-guide).
//
// Разделено на две части, потому что заголовок общий и для правки, и для
// мастера, а секции с рейлом — только для правки.

/**
 * Якорь секции по её ключу. Экспортируется, потому что на него ссылаются и
 * снаружи: тело секции может звать «перейти к другой секции» — например, плашка
 * типа аккаунта в правах ведёт к самому полю типа в «Основном».
 */
export const sectionAnchorId = (key) => `form-section-${key}`;

/**
 * Липкий заголовок формы. Скроллится внутренность шторки (app/FormSheet),
 * поэтому заголовок остаётся на месте вместе с крестиком, а `onHeight`
 * отдаёт его высоту рейлу — тот прижимается ровно под него.
 */
export const FormHeader = ({ title, subtitle, onHeight, children }) => (
  <div
    ref={(node) => {
      if (node) onHeight?.(node.offsetHeight);
    }}
    className="sticky top-0 z-10 -mx-6 -mt-5 mb-3 border-b border-border-soft bg-background px-6 pt-5 pb-3"
  >
    <h1 className="my-0 pr-10 text-2xl font-semibold tracking-tight">
      {title}
    </h1>
    {subtitle && (
      <p className="mt-1 mb-0 text-sm text-muted-foreground">{subtitle}</p>
    )}
    {/* Тихий контрол при заголовке — вход «Из шаблона» у новой заявки: он
        задаёт заготовку всей формы, а не правит одно поле, поэтому стоит в
        шапке, а не полем среди прочих */}
    {children && <div className="mt-3">{children}</div>}
  </div>
);

/**
 * Секции правки одним скроллом + рейл по ним.
 *
 * sections: [{ key, title, desc?, body }] — key служит и якорем: ярлык секции
 * на карточке ведёт в форму хешем (`update#checklist`), и она открывается уже
 * прокрученной к нужному месту.
 *
 * rail=false выключает рейл, оставляя секции и якоря: у формы заявки секций
 * две, и рейл вёл бы по двум пунктам — переход по хешу работает и без него.
 */
export const FormSections = ({
  sections,
  headHeight = 0,
  ariaLabel = "Разделы формы",
  rail = true,
}) => {
  const location = useLocation();
  const scroller = useContext(OverlayScrollContext);
  const anchorId = sectionAnchorId;

  const keys = sections.map((section) => section.key).join("|");
  useEffect(() => {
    const anchor = location.hash.replace("#", "");
    if (!anchor || !keys.split("|").includes(anchor)) return undefined;
    // Без анимации: секция должна быть на месте уже при открытии шторки
    const timer = setTimeout(
      () => scrollToSection(scroller, anchorId(anchor), false),
      0,
    );
    return () => clearTimeout(timer);
  }, [location.hash, scroller, keys]);

  return (
    <div className="flex items-start gap-7">
      {rail && sections.length > 1 && (
        <BrowserView className="contents">
          <AnchorRail
            sections={sections.map((section) => ({
              id: anchorId(section.key),
              label: section.title,
            }))}
            ariaLabel={ariaLabel}
            offset={headHeight + 24}
            style={{ top: headHeight }}
          />
        </BrowserView>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {sections.map((section) => (
          <section
            key={section.key}
            id={anchorId(section.key)}
            className="border-t border-border-soft py-5 first:border-t-0 first:pt-1"
          >
            <h3 className="my-0 text-base font-semibold tracking-tight">
              {section.title}
            </h3>
            {section.desc && (
              <p className="mt-0.5 mb-0 text-sm text-muted-foreground">
                {section.desc}
              </p>
            )}
            <div className="mt-4">{section.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
};
