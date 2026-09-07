import { monogramFor } from "@/components/app/monogram";
import { cn } from "@/lib/utils";

// Аватар пользователя с кольцом-присутствием — общий для строки списка,
// контакт-шторки и карточки. В списках это такая же плитка со скруглением,
// как логотип компании или фото модели (`shape="tile"`, по умолчанию): круг
// среди квадратов читался как чужой элемент. Круг (`shape="round"`) остаётся
// hero карточки и шторке-справке. Фото рисуем фоном на <span>, а не <img>:
// глобальный img{width/height:auto!important} (хак картинок заявок) ломает
// фиксированные размеры. Нет фото — инициалы.
const API = import.meta.env.VITE_API_ADDRESS;

// Кольцо: тонкое для строк/шторки, толще для героя карточки. box-shadow
// повторяет скругление — одно и то же кольцо у плитки и у круга.
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
  /** "tile" — плитка со скруглением (списки); "round" — круг (hero, шторка). */
  shape = "tile",
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
        "grid flex-none place-items-center overflow-hidden bg-accent bg-cover bg-center font-semibold text-muted-foreground",
        shape === "round" ? "rounded-full" : "rounded-xl",
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
