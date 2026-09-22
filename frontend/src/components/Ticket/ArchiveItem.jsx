import { RiExternalLinkLine, RiRepeat2Line } from "react-icons/ri";

import { formatShortDate } from "../../util/format-date";

// Строка архива заявок (read-only): номер · тема + мета · ответственные ·
// даты «закрыта / создана». Вся строка — ссылка на заявку в новой вкладке
// (выдача с фильтрами остаётся на месте); «↗» проявляется по наведению.
// Значок ↻ у номера — заявка создана регламентом. На мобайле — три яруса:
// номер + дата закрытия / тема / компания · инициатор.

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
      className="ms-1 inline text-faint"
      style={{ verticalAlign: "-2px" }}
    />
  );

  return (
    <a
      href={`/tickets/${ticket.num}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col gap-0.5 px-4 py-3 text-foreground no-underline transition-colors before:absolute before:top-0 before:right-5 before:left-5 before:h-px before:bg-border-soft first:before:hidden hover:bg-accent/60 hover:text-foreground md:flex-row md:items-center md:gap-4 md:px-5 md:py-2.5"
    >
      {/* мобайл: номер + дата закрытия */}
      <div className="flex items-baseline gap-1 text-xs text-muted-foreground tabular-nums md:hidden">
        <span>{ticket.num}</span>
        {routineMark}
        <span className="ms-auto text-faint">
          закрыта {formatShortDate(ticket.finishedAt)}
        </span>
      </div>

      {/* десктоп: колонка номера */}
      <div className="hidden w-20 flex-none font-medium text-muted-foreground tabular-nums md:block">
        {ticket.num}
        {routineMark}
      </div>

      {/* тема + мета */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-base leading-tight font-medium">{ticket.title}</div>
        <div className="hidden truncate text-sm text-muted-foreground md:block">
          {desktopMeta || "—"}
        </div>
        <div className="truncate text-sm text-muted-foreground md:hidden">
          {mobileMeta || "—"}
        </div>
      </div>

      {/* десктоп: ответственные */}
      <div className="hidden w-42 flex-none truncate text-sm text-muted-foreground lg:block">
        {responsibleNames(ticket.responsibles)}
      </div>

      {/* десктоп: даты */}
      <div className="hidden w-44 flex-none text-right tabular-nums md:block">
        <div className="text-sm">
          <span className="text-xs text-muted-foreground">закрыта </span>
          {formatShortDate(ticket.finishedAt)}
        </div>
        <div className="text-xs text-faint">
          создана {formatShortDate(ticket.createdAt)}
        </div>
      </div>

      {/* десктоп: ↗ по наведению */}
      <div className="hidden w-5 flex-none justify-end text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 md:flex">
        <RiExternalLinkLine size={15} aria-hidden />
      </div>
    </a>
  );
};

export default ArchiveItem;
