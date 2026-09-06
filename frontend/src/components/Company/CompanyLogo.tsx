import { RiBuilding2Line } from "react-icons/ri";

import { cn } from "@/lib/utils";

// Плитка компании: логотип фоном на <span> с кольцом по краю; без логотипа —
// тихий глиф раздела: блёклый, без кольца и без букв (монограмма из двух букв
// повторяла название рядом и читалась как шум). Квадрат со скруглением — язык
// записей; круг остаётся людям (см. макет «Плитка строки списка»).
type CompanyLike = {
  alias?: string | null;
  profileImagePath?: string | null;
};

type CompanyLogoProps = {
  company?: CompanyLike | null;
  /** Переопределение картинки (превью после загрузки на карточке). */
  src?: string | null;
  sizeClass?: string;
  /** Размер глифа-заглушки в px: 22 у плитки строки (`size-12`), 26 у hero
   *  (`size-14`), 18 у сводки формы (`size-10`). */
  glyphSize?: number;
  className?: string;
};

const CompanyLogo = ({
  company,
  src,
  sizeClass = "size-13",
  glyphSize = 22,
  className,
}: CompanyLogoProps) => {
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
        aria-label={company?.alias ?? undefined}
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
        "grid flex-none place-items-center rounded-xl bg-accent text-faint",
        sizeClass,
        className,
      )}
    >
      <RiBuilding2Line size={glyphSize} />
    </span>
  );
};

export default CompanyLogo;
