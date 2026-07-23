import { RiExternalLinkLine, RiRepeat2Line } from "react-icons/ri";

import { formatShortDate } from "../../util/format-date";

// Строка архива заявок (read-only): номер · тема + мета · ответственные ·
// даты «закрыта / создана». Вся строка — ссылка на заявку в новой вкладке
// (выдача с фильтрами остаётся на месте); «↗» проявляется по наведению.
// Значок ↻ у номера — заявка создана регламентом. На мобайле — три яруса:
// № + дата закрытия / тема / компания · инициатор.

// 1 ответственный — полное имя, несколько — «Фамилия И.» через запятую
const responsibleNames = (responsibles) => {
  if (!responsibles?.length) return "";
  if (responsibles.length === 1) {
    const { lastName, firstName } = responsibles[0];
    return `${lastName || ""} ${firstName || ""}`.trim();
  }
  return responsibles
    .map(({ lastName, firstName }) =>
      `${lastName || ""} ${firstName ? `${firstName[0]}.` : ""}`.trim(),
    )
    .join(", ");
};

const ArchiveItem = ({ ticket }) => {
  const applicantName = ticket.applicant
    ? `${ticket.applicant.lastName || ""} ${ticket.applicant.firstName || ""}`.trim()
    : "";
  const desktopMeta = [
    ticket.category?.title,
    ticket.company?.alias,
    applicantName,
  ]
    .filter(Boolean)
    .join(" · ");
  const mobileMeta = [ticket.company?.alias, applicantName]
    .filter(Boolean)
    .join(" · ");

  const routineMark = ticket.isRoutine && (
    <RiRepeat2Line
      size={13}
      aria-label="Создана регламентом"
      title="Создана регламентом"
      className="tw:ms-1 tw:inline tw:text-faint"
      style={{ verticalAlign: "-2px" }}
    />
  );

  return (
    <a
      href={`/tickets/${ticket.num}`}
      target="_blank"
      rel="noopener noreferrer"
      className="tw:group tw:relative tw:flex tw:flex-col tw:gap-0.5 tw:px-4 tw:py-3 tw:text-foreground tw:no-underline tw:transition-colors tw:before:absolute tw:before:top-0 tw:before:right-5 tw:before:left-5 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden tw:hover:bg-accent/60 tw:hover:text-foreground tw:md:flex-row tw:md:items-center tw:md:gap-4 tw:md:px-5 tw:md:py-2.5"
    >
      {/* мобайл: № + дата закрытия */}
      <div className="tw:flex tw:items-baseline tw:gap-1 tw:text-xs tw:text-muted-foreground tw:tabular-nums tw:md:hidden">
        <span>№ {ticket.num}</span>
        {routineMark}
        <span className="tw:ms-auto tw:text-faint">
          закрыта {formatShortDate(ticket.finishedAt)}
        </span>
      </div>

      {/* десктоп: колонка номера */}
      <div className="tw:hidden tw:w-20 tw:flex-none tw:font-medium tw:text-muted-foreground tw:tabular-nums tw:md:block">
        {ticket.num}
        {routineMark}
      </div>

      {/* тема + мета */}
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:truncate tw:font-medium">{ticket.title}</div>
        <div className="tw:hidden tw:truncate tw:text-sm tw:text-muted-foreground tw:md:block">
          {desktopMeta || "—"}
        </div>
        <div className="tw:truncate tw:text-sm tw:text-muted-foreground tw:md:hidden">
          {mobileMeta || "—"}
        </div>
      </div>

      {/* десктоп: ответственные */}
      <div className="tw:hidden tw:w-42 tw:flex-none tw:truncate tw:text-sm tw:text-muted-foreground tw:lg:block">
        {responsibleNames(ticket.responsibles)}
      </div>

      {/* десктоп: даты */}
      <div className="tw:hidden tw:w-44 tw:flex-none tw:text-right tw:tabular-nums tw:md:block">
        <div className="tw:text-sm">
          <span className="tw:text-xs tw:text-muted-foreground">закрыта </span>
          {formatShortDate(ticket.finishedAt)}
        </div>
        <div className="tw:text-xs tw:text-faint">
          создана {formatShortDate(ticket.createdAt)}
        </div>
      </div>

      {/* десктоп: ↗ по наведению */}
      <div className="tw:hidden tw:w-5 tw:flex-none tw:justify-end tw:text-muted-foreground tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:md:flex">
        <RiExternalLinkLine size={15} aria-hidden />
      </div>
    </a>
  );
};

export default ArchiveItem;
