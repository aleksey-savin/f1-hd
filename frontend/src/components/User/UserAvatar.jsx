import { monogramFor } from "@/components/app/monogram";
import { cn } from "@/lib/utils";

// Круглый аватар пользователя с кольцом-присутствием — общий для строки списка,
// контакт-шторки и карточки. Фото рисуем фоном на <span>, а не <img>: глобальный
// img{width/height:auto!important} (хак картинок заявок) ломает фиксированные
// размеры. Нет фото — инициалы.
const API = import.meta.env.VITE_API_ADDRESS;

// Кольцо: тонкое для строк/шторки, толще для героя карточки.
const RING = {
  sm: "0 0 0 2px var(--card), 0 0 0 4px",
  lg: "0 0 0 3px var(--card), 0 0 0 6px",
};

const UserAvatar = ({
  user,
  /** Переопределение картинки (превью после загрузки на карточке). */
  src,
  sizeClass = "tw:size-13",
  textClass = "tw:text-base",
  ringColor = null,
  ring = "sm",
  className,
}) => {
  const fullName = `${user.lastName || ""} ${user.firstName || ""}`.trim();
  const image =
    src !== undefined
      ? src
      : user.profileImagePath
        ? `${API}/uploads/${user.profileImagePath}`
        : null;

  return (
    <span
      role="img"
      aria-label={fullName || "Пользователь"}
      style={{
        ...(image ? { backgroundImage: `url("${image}")` } : {}),
        ...(ringColor ? { boxShadow: `${RING[ring]} ${ringColor}` } : {}),
      }}
      className={cn(
        "tw:grid tw:flex-none tw:place-items-center tw:overflow-hidden tw:rounded-full tw:bg-accent tw:bg-cover tw:bg-center tw:font-semibold tw:text-muted-foreground",
        sizeClass,
        textClass,
        !ringColor && "tw:inset-ring tw:inset-ring-border",
        image && "tw:text-transparent",
        className,
      )}
    >
      {!image && monogramFor(fullName)}
    </span>
  );
};

export default UserAvatar;
