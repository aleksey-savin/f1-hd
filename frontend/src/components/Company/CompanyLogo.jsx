import { cn } from "@/lib/utils";
import { monogramFor } from "@/components/app/monogram";

// Плитка компании: логотип (фоном на <span> — в обход глобального
// img{width/height:auto!important}) или монограмма. Квадрат со скруглением —
// язык записей; круг остаётся людям (см. макет списка компаний).
const CompanyLogo = ({
  company,
  /** Переопределение картинки (превью после загрузки на карточке). */
  src,
  sizeClass = "size-13",
  textClass = "text-lg",
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
          // block обязателен: вне flex-контейнера (обёртка HeroLogo)
          // инлайновый span игнорирует size-* и плитка схлопывается в ноль
          "block flex-none rounded-xl bg-cover bg-center inset-ring inset-ring-border",
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
        "grid flex-none place-items-center rounded-xl bg-accent font-semibold text-muted-foreground inset-ring inset-ring-border",
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
