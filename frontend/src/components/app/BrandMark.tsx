import { cn } from "@/lib/utils";
import { DEFAULT_PRODUCT_NAME } from "@/util/brand.js";

import BrandGlyph from "./BrandGlyph";

// Марка приложения в одном месте: бар оболочки и пред-авторизационные экраны
// показывают её одинаково. Задан логотип арендатора (Preferences.contacts.logo)
// — он вытесняет и знак, и слово. Не задан — знак портала и его название
// («Настройки → Бренд») цветом текста: название произвольное, поэтому
// двухцветного слова здесь нет.
//
// Размер картинки задаём ИНЛАЙНОМ через max-height: глобальный автоскейл <img>
// в index.css ставит width/height: auto !important и перебил бы tw-классы
// (см. «Глобальный автоскейл <img>» в docs/ux-ui-guide.md).

const WORD_SIZE = {
  sm: "text-base",
  default: "text-lg",
  lg: "text-xl",
} as const;

const LOGO_HEIGHT = { sm: 28, default: 32, lg: 32 } as const;

const GLYPH_SIZE = { sm: 20, default: 22, lg: 24 } as const;

const BrandMark = ({
  logo,
  name,
  icon,
  size = "default",
  className,
}: {
  /** Имя файла логотипа арендатора в uploads; пусто — знак и название. */
  logo?: string;
  /** Название портала (`brand.productName`). */
  name?: string;
  /** Имя файла своего значка (`brand.icon`); пусто — знак по умолчанию. */
  icon?: string;
  size?: keyof typeof WORD_SIZE;
  className?: string;
}) => {
  if (logo) {
    return (
      <img
        src={`${import.meta.env.VITE_API_ADDRESS}/uploads/${logo}`}
        alt="Логотип компании"
        style={{ maxHeight: LOGO_HEIGHT[size] }}
        className={className}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-2.25 font-bold tracking-tight text-foreground",
        WORD_SIZE[size],
        className,
      )}
    >
      <BrandGlyph size={GLYPH_SIZE[size]} icon={icon} />
      <span className="min-w-0 truncate">{name || DEFAULT_PRODUCT_NAME}</span>
    </span>
  );
};

export default BrandMark;
