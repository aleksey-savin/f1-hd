import { cn } from "@/lib/utils";

// Марка приложения в одном месте: бар оболочки и пред-авторизационные экраны
// показывают её одинаково. Задан логотип арендатора (Preferences.contacts.logo)
// — он вытесняет и знак, и слово; иначе рисуется текстовый бренд.
//
// Размер картинки задаём ИНЛАЙНОМ через max-height: глобальный автоскейл <img>
// в index.css ставит width/height: auto !important и перебил бы tw-классы
// (см. «Глобальный автоскейл <img>» в docs/ux-ui-guide.md).

const WORD_SIZE = {
  sm: "tw:text-base",
  default: "tw:text-lg",
  lg: "tw:text-xl",
} as const;

const LOGO_HEIGHT = { sm: 28, default: 32, lg: 32 } as const;
const MARK_HEIGHT = { sm: 24, default: 28, lg: 32 } as const;

const BrandMark = ({
  logo,
  size = "default",
  mark = false,
  className,
}: {
  /** Имя файла логотипа арендатора в uploads; пусто — текстовый бренд. */
  logo?: string;
  size?: keyof typeof WORD_SIZE;
  /** Показать знак приложения слева от слова (пред-авторизационные экраны). */
  mark?: boolean;
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
    <span className={cn("tw:inline-flex tw:items-center tw:gap-2.5", className)}>
      {mark && (
        <img
          src="/logo.png"
          alt=""
          aria-hidden="true"
          style={{ maxHeight: MARK_HEIGHT[size] }}
        />
      )}
      <span
        className={cn(
          "tw:font-bold tw:tracking-tight tw:text-foreground",
          WORD_SIZE[size],
        )}
      >
        Help<span className="tw:text-primary">Desk</span>
      </span>
    </span>
  );
};

export default BrandMark;
