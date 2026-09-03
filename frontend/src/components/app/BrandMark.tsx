import { cn } from "@/lib/utils";

// Марка приложения в одном месте: бар оболочки и пред-авторизационные экраны
// показывают её одинаково. Единственная картинка здесь — логотип арендатора
// (Preferences.contacts.logo); задан — он вытесняет слово, не задан — рисуется
// текстовый бренд. Своего знака у приложения нет: картинка, которую не
// задавали в настройках, читалась бы как чужой бренд на чужом портале.
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

const BrandMark = ({
  logo,
  size = "default",
  className,
}: {
  /** Имя файла логотипа арендатора в uploads; пусто — текстовый бренд. */
  logo?: string;
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
        "inline-flex items-center font-bold tracking-tight text-foreground",
        WORD_SIZE[size],
        className,
      )}
    >
      Help<span className="text-primary">Desk</span>
    </span>
  );
};

export default BrandMark;
