import { cn } from "@/lib/utils";
import { monogramFor } from "@/components/app/monogram";

// Плитка компании: логотип (фоном на <span> — в обход глобального
// img{width/height:auto!important}) или монограмма. Квадрат со скруглением —
// язык записей; круг остаётся людям (см. макет списка компаний).
const CompanyLogo = ({
  company,
  /** Переопределение картинки (превью после загрузки на карточке). */
  src,
  sizeClass = "tw:size-13",
  textClass = "tw:text-lg",
  className,
}) => {
  const logoSrc =
    src !== undefined
      ? src
      : company?.profileImagePath
        ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${company.profileImagePath}`
        : null;

  if (logoSrc) {
    return (
      <span
        role="img"
        aria-label={company?.alias}
        className={cn(
          // tw:block обязателен: вне flex-контейнера (обёртка HeroLogo)
          // инлайновый span игнорирует size-* и плитка схлопывается в ноль
          "tw:block tw:flex-none tw:rounded-xl tw:bg-cover tw:bg-center tw:inset-ring tw:inset-ring-border",
          sizeClass,
          className,
        )}
        style={{ backgroundImage: `url(${logoSrc})` }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "tw:grid tw:flex-none tw:place-items-center tw:rounded-xl tw:bg-accent tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border",
        sizeClass,
        textClass,
        className,
      )}
    >
      {monogramFor(company?.alias)}
    </span>
  );
};

export default CompanyLogo;
