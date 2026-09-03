import { getWorkStatusMeta } from "../../util/work-statuses";

// Кругляш сотрудника: фото профиля (или инициалы) + кольцо цвета статуса +
// мини-бейдж с иконкой статуса. Общий для навбара, рейла статусов и блока
// «Команда сейчас». Фото — фоном на <span>, потому что размер задаётся
// инлайном от пропа `size`.
//
// В бейдже иконка каталога (`Ri*`), а не эмодзи: эмодзи нужны Telegram-табло,
// в вебе они рисуются по-разному на каждой ОС и держались на подгонках
// полупикселями. Иконка красится цветом статуса — тем же, что кольцо.
//
// В CSS остаются только две вещи, которых нет в сетке: кольцо
// `box-shadow: 0 0 0 2px var(--ws-color)` (цвет приезжает инлайном из каталога
// статусов) и размер бейджа `max(21px, 1.65em)` — он масштабируется от кругляша,
// но не мельче читаемого минимума.
const WorkStatusAvatar = ({
  firstName,
  lastName,
  profileImagePath,
  workStatus,
  size = 36,
  showBadge = true,
}) => {
  const meta = getWorkStatusMeta(workStatus?.code);
  const Icon = meta.icon;
  const initials =
    `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.trim() || "?";
  const avatarSrc = profileImagePath
    ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${profileImagePath}`
    : null;

  return (
    <span
      className="ws-avatar relative m-0.5 inline-flex flex-none items-center justify-center rounded-full bg-ws-avatar bg-cover bg-center leading-none font-bold text-ws-avatar-fg"
      style={{
        "--ws-color": meta.color,
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.round(size * 0.36)}px`,
        ...(avatarSrc ? { backgroundImage: `url(${avatarSrc})` } : {}),
      }}
      role="img"
      aria-label={`${lastName ?? ""} ${firstName ?? ""} — ${meta.label}`}
    >
      {!avatarSrc && initials}
      {showBadge && (
        <span
          className="ws-avatar__badge absolute grid place-items-center rounded-full border border-ws-line bg-ws-surface leading-none"
          style={{ color: meta.color }}
          aria-hidden="true"
        >
          {Icon ? (
            <Icon style={{ width: "62%", height: "62%" }} />
          ) : (
            meta.emoji
          )}
        </span>
      )}
    </span>
  );
};

export default WorkStatusAvatar;
