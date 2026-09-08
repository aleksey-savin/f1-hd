import { monogramFor } from "@/components/app/monogram";
import { cn } from "@/lib/utils";

// Аватар пользователя с кольцом-присутствием — общий для строки списка,
// контакт-шторки, hero карточки и «Моего аккаунта». Одна форма на любом
// размере: та же плитка со скруглением, что у логотипа компании или фото
// модели, скругление — четверть стороны (`rounded-[25%]`: 12 px при 48,
// 20 у hero 80). Круга у человека нет нигде — среди квадратов он читался как
// чужой элемент, а один и тот же человек менял форму от списка к карточке;
// круглыми остаются только бейджи поверх плитки (статус, камера). Фото
// рисуем фоном на <span>, а не <img>: глобальный
// img{width/height:auto!important} (хак картинок заявок) ломает
// фиксированные размеры. Нет фото — инициалы.
const API = import.meta.env.VITE_API_ADDRESS;

// Кольцо: тонкое для строк/шторки, толще для героя карточки. box-shadow
// повторяет скругление плитки сам, отдельного слоя под кольцо не нужно.
const RING = {
  sm: "0 0 0 2px var(--card), 0 0 0 4px",
  lg: "0 0 0 3px var(--card), 0 0 0 6px",
};

const UserAvatar = ({
  user,
  /** Переопределение картинки (превью после загрузки на карточке). */
  src,
  sizeClass = "size-13",
  textClass = "text-base",
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
        "grid flex-none place-items-center overflow-hidden rounded-[25%] bg-accent bg-cover bg-center font-semibold text-muted-foreground",
        sizeClass,
        textClass,
        !ringColor && "inset-ring inset-ring-border",
        image && "text-transparent",
        className,
      )}
    >
      {!image && monogramFor(fullName)}
    </span>
  );
};

export default UserAvatar;
