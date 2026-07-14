import { useContext, useEffect, useState } from "react";

import { RiArrowLeftSLine, RiArrowDownSLine } from "react-icons/ri";

import { AuthedUserContext } from "../../store/authed-user-context";
import useWorkStatusesStore from "../../store/work-statuses";
import usePolling from "../../hooks/use-polling";
import { WORK_STATUSES } from "../../util/work-statuses";
import WorkStatusAvatar from "./WorkStatusAvatar";

const STORAGE_KEY = "workStatusBarOpen";

// «с HH:MM» для сегодняшних смен статуса, «с DD.MM» для более старых
const sinceLabel = (updatedAt) => {
  if (!updatedAt) {
    return "";
  }
  const date = new Date(updatedAt);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? `с ${date.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}`
    : `с ${date.toLocaleDateString("ru", { day: "2-digit", month: "2-digit" })}`;
};

// Строка сотрудника в развёрнутом виде: имя, статус текстом, заметка, время
const PersonRow = ({ user, status }) => (
  <div className="ws-person" key={user._id}>
    <WorkStatusAvatar
      size={44}
      firstName={user.firstName}
      lastName={user.lastName}
      profileImagePath={user.profileImagePath}
      workStatus={user.workStatus}
    />
    <span className="ws-person__text">
      <span className="ws-person__name">
        {user.lastName} {user.firstName}
      </span>
      <span className="ws-person__status" style={{ color: status.color }}>
        {status.label}
        {user.workStatus?.updatedAt && (
          <span className="ws-person__time">
            {" "}
            · {sinceLabel(user.workStatus.updatedAt)}
          </span>
        )}
      </span>
      {user.workStatus?.note && (
        <span className="ws-person__note">{user.workStatus.note}</span>
      )}
    </span>
  </div>
);

const personTitle = (user, status) =>
  `${user.lastName} ${user.firstName} — ${status.label}` +
  (user.workStatus?.note ? ` (${user.workStatus.note})` : "");

// Бар статусов сотрудников. Два варианта по утверждённому макету:
// - rail: вертикальная панель у правого края (десктоп), свёрнута до колонки
//   кругляшей, раскрывается в список со статусом текстом;
// - strip: тонкая лента сверху (мобильный app-shell), горизонтальный скролл
//   со скрытым скролл-баром, тап раскрывает список вниз.
// Авторизованный пользователь в списки не попадает — его статус в навбаре.
const WorkStatusBar = ({ variant = "rail" }) => {
  const authedUser = useContext(AuthedUserContext);
  const { users, isLoaded, silentRefresh } = useWorkStatusesStore();
  const [open, setOpen] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );

  const isStaff =
    !!authedUser._id && !authedUser.isEndUser && !authedUser.hideWorkStatus;

  useEffect(() => {
    if (isStaff) {
      silentRefresh();
    }
  }, [isStaff, silentRefresh]);

  usePolling(silentRefresh, { intervalMs: 15000, enabled: isStaff });

  if (!isStaff || !isLoaded) {
    return null;
  }

  const colleagues = users.filter(
    (user) => String(user._id) !== String(authedUser._id),
  );
  if (colleagues.length === 0) {
    return null;
  }

  const groups = WORK_STATUSES.map((status) => ({
    status,
    users: colleagues.filter(
      (user) => (user.workStatus?.code || "unset") === status.code,
    ),
  })).filter((group) => group.users.length > 0);

  const summary = groups
    .filter((group) => group.status.code !== "unset")
    .slice(0, 3)
    .map((group) => `${group.users.length} ${group.status.label}`)
    .join(" · ");

  const toggle = () => {
    setOpen((prev) => {
      localStorage.setItem(STORAGE_KEY, String(!prev));
      return !prev;
    });
  };

  if (variant === "strip") {
    return (
      <div className={`ws-strip${open ? " ws-strip--open" : ""}`}>
        <button
          type="button"
          className="ws-strip__head"
          aria-expanded={open}
          aria-label="Статусы сотрудников"
          onClick={toggle}
        >
          <span className="ws-live" aria-hidden="true" />
          <span className="ws-strip__scrollwrap">
            <span className="ws-strip__scroll">
              {groups.map((group) => (
                <span key={group.status.code} className="ws-strip__group">
                  {group.users.map((user) => (
                    <WorkStatusAvatar
                      key={user._id}
                      size={36}
                      firstName={user.firstName}
                      lastName={user.lastName}
                      profileImagePath={user.profileImagePath}
                      workStatus={user.workStatus}
                    />
                  ))}
                </span>
              ))}
            </span>
          </span>
          <RiArrowDownSLine className="ws-strip__chev" aria-hidden="true" />
        </button>

        {open && (
          <div className="ws-strip__panel">
            {groups.map((group) => (
              <div key={group.status.code} className="ws-strip__panel-group">
                <p className="ws-group-h" style={{ color: group.status.color }}>
                  {group.status.emoji} {group.status.label} ·{" "}
                  {group.users.length}
                </p>
                {group.users.map((user) => (
                  <PersonRow
                    key={user._id}
                    user={user}
                    status={group.status}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`ws-rail d-none d-lg-flex${open ? " ws-rail--open" : ""}`}
    >
      <button
        type="button"
        className="ws-rail__head"
        aria-expanded={open}
        onClick={toggle}
        title={open ? "Свернуть" : "Статусы сотрудников"}
      >
        <RiArrowLeftSLine className="ws-rail__chev" aria-hidden="true" />
        {open && (
          <span className="ws-rail__title">
            <span className="ws-rail__eyebrow">
              <span className="ws-live" aria-hidden="true" /> Сотрудники
            </span>
            {summary && <span className="ws-rail__summary">{summary}</span>}
          </span>
        )}
      </button>

      <div className="ws-rail__body">
        {groups.map((group) => (
          <div key={group.status.code} className="ws-rail__group">
            {open && (
              <p className="ws-group-h" style={{ color: group.status.color }}>
                {group.status.emoji} {group.status.label} · {group.users.length}
              </p>
            )}
            {open
              ? group.users.map((user) => (
                  <PersonRow
                    key={user._id}
                    user={user}
                    status={group.status}
                  />
                ))
              : group.users.map((user) => (
                  <div
                    key={user._id}
                    className="ws-person"
                    title={personTitle(user, group.status)}
                  >
                    <WorkStatusAvatar
                      size={44}
                      firstName={user.firstName}
                      lastName={user.lastName}
                      profileImagePath={user.profileImagePath}
                      workStatus={user.workStatus}
                    />
                  </div>
                ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default WorkStatusBar;
