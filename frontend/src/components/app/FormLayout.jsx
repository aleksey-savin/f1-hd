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
 * Липкий заголовок формы. Скроллится внутренность шторки (app/FormSheet),
 * поэтому заголовок остаётся на месте вместе с крестиком, а `onHeight`
 * отдаёт его высоту рейлу — тот прижимается ровно под него.
 */
export const FormHeader = ({ title, subtitle, onHeight, children }) => (
  <div
    ref={(node) => {
      if (node) onHeight?.(node.offsetHeight);
    }}
    className="tw:sticky tw:top-0 tw:z-10 tw:-mx-6 tw:-mt-5 tw:mb-3 tw:border-b tw:border-border-soft tw:bg-background tw:px-6 tw:pt-5 tw:pb-3"
  >
    <h1 className="tw:my-0 tw:pr-10 tw:text-2xl tw:font-semibold tw:tracking-tight">
      {title}
    </h1>
    {subtitle && (
      <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:text-muted-foreground">
        {subtitle}
      </p>
    )}
    {/* Тихий контрол при заголовке — вход «Из шаблона» у новой заявки: он
        задаёт заготовку всей формы, а не правит одно поле, поэтому стоит в
        шапке, а не полем среди прочих */}
    {children && <div className="tw:mt-3">{children}</div>}
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
  const anchorId = (key) => `form-section-${key}`;

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
    <div className="tw:flex tw:items-start tw:gap-7">
      {rail && sections.length > 1 && (
        <BrowserView className="tw:contents">
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
      <div className="tw:min-w-0 tw:flex-1 tw:space-y-1">
        {sections.map((section) => (
          <section
            key={section.key}
            id={anchorId(section.key)}
            className="tw:border-t tw:border-border-soft tw:py-5 tw:first:border-t-0 tw:first:pt-1"
          >
            <h3 className="tw:my-0 tw:text-base tw:font-semibold tw:tracking-tight">
              {section.title}
            </h3>
            {section.desc && (
              <p className="tw:mt-0.5 tw:mb-0 tw:text-sm tw:text-muted-foreground">
                {section.desc}
              </p>
            )}
            <div className="tw:mt-4">{section.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
};
