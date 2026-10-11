import { brandIconUrl } from "@/util/brand.js";

// Знак портала: скруглённый квадрат цвета акцента с разомкнутым кольцом.
// Рисуется, пока в «Настройках → Бренд» не загружен свой значок; загружен —
// в той же рамке показывается он. Цвета берутся из токенов, поэтому знак
// перекрашивается вместе с акцентом и читается в обеих темах.
//
// Размер картинки задаём ИНЛАЙНОМ, как у логотипа в BrandMark: от классов
// размер картинки зависеть не должен (см. «Глобальный автоскейл <img>» в
// docs/ux-ui-guide.md).

// Скругление — четверть стороны (rx 6 при поле 24)
const RADIUS_SHARE = 6 / 24;

const BrandGlyph = ({
  size = 22,
  icon = "",
  className,
}: {
  /** Сторона знака в пикселях. */
  size?: number;
  /** Имя файла своего значка (`brand.icon`); пусто — знак по умолчанию. */
  icon?: string;
  className?: string;
}) => {
  if (icon) {
    return (
      <img
        src={brandIconUrl(import.meta.env.VITE_API_ADDRESS, icon)}
        alt=""
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: size * RADIUS_SHARE,
          flex: "none",
          objectFit: "cover",
        }}
        className={className}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ flex: "none" }}
      className={className}
    >
      <rect width="24" height="24" rx="6" fill="var(--primary)" />
      <circle
        cx="12"
        cy="12"
        r="5.2"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="2.6"
        strokeDasharray="24 8.7"
        strokeLinecap="round"
        transform="rotate(-50 12 12)"
      />
    </svg>
  );
};

export default BrandGlyph;
