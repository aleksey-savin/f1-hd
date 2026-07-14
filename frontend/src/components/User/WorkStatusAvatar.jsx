import { getWorkStatusMeta } from "../../util/work-statuses";

// Кругляш сотрудника: фото профиля (или инициалы) + кольцо цвета статуса +
// мини-эмодзи-бейдж. Общий для навбара и бара статусов. Фон рисуем на <span>
// в обход глобального img{width:auto!important} — как у .user-mini-avatar.
const WorkStatusAvatar = ({
  firstName,
  lastName,
  profileImagePath,
  workStatus,
  size = 36,
  showBadge = true,
}) => {
  const meta = getWorkStatusMeta(workStatus?.code);
  const initials =
    `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.trim() || "?";
  const avatarSrc = profileImagePath
    ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${profileImagePath}`
    : null;

  return (
    <span
      className="ws-avatar"
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
        <span className="ws-avatar__badge" aria-hidden="true">
          {meta.emoji}
        </span>
      )}
    </span>
  );
};

export default WorkStatusAvatar;
