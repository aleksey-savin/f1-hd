import { formatShortDate } from "../../util/format-date";

import { LONG_WORK_MS, formatDuration } from "./duration";

// Строка архива работ (read-only): номера-ссылки связанных заявок · описание + мета
// «компания · категории · инициаторы» · исполнитель · длительность и дата
// завершения. Сама строка никуда не ведёт (у работы нет карточки) —
// кликабельны только номера заявок (новая вкладка, выдача остаётся на месте).
// Длительность от 12 часов — warning-текст с точкой, строка не заливается.
// На мобайле — три яруса: номера + длительность / описание / компания · исполнитель.

// 1 инициатор — полное имя, несколько — «Фамилия И.» через запятую
const applicantNames = (tickets) => {
  const seen = new Set();
  const applicants = [];
  for (const ticket of tickets || []) {
    const applicant = ticket.applicant;
    if (!applicant?._id || seen.has(String(applicant._id))) continue;
    seen.add(String(applicant._id));
    applicants.push(applicant);
  }
  if (!applicants.length) return "";
  if (applicants.length === 1) {
    const { lastName, firstName } = applicants[0];
    return `${lastName || ""} ${firstName || ""}`.trim();
  }
  return applicants
    .map(({ lastName, firstName }) =>
      `${lastName || ""} ${firstName ? `${firstName[0]}.` : ""}`.trim(),
    )
    .join(", ");
};

const categoryTitles = (tickets) => {
  const titles = new Set();
  for (const ticket of tickets || []) {
    if (ticket.category?.title) titles.add(ticket.category.title);
  }
  return [...titles].join(", ");
};

const executorName = (finishedBy) =>
  finishedBy
    ? `${finishedBy.lastName || ""} ${finishedBy.firstName || ""}`.trim()
    : "";

const TicketLink = ({ ticket }) => (
  <a
    href={`/tickets/${ticket.num}`}
    target="_blank"
    rel="noopener noreferrer"
    title={ticket.title}
    className="font-medium text-accent-text tabular-nums no-underline hover:underline"
  >
    {ticket.num}
  </a>
);

const WorkArchiveItem = ({ work }) => {
  const durationMs =
    new Date(work.finishedAt) - new Date(work.startedAt || work.finishedAt);
  const isLong = durationMs >= LONG_WORK_MS;

  const desktopMeta = [
    work.company?.alias,
    categoryTitles(work.tickets),
    applicantNames(work.tickets),
  ]
    .filter(Boolean)
    .join(" · ");
  const mobileMeta = [work.company?.alias, executorName(work.finishedBy)]
    .filter(Boolean)
    .join(" · ");
  const mobileNums = (work.tickets || [])
    .map((ticket) => ticket.num)
    .join(" · ");

  const duration = (
    <span
      className={isLong ? "font-semibold text-warning" : "font-semibold"}
      title={isLong ? "Длительность больше 12 часов" : undefined}
    >
      {isLong && (
        <span
          aria-hidden
          className="me-1.5 inline-block size-1.5 rounded-full bg-warning"
          style={{ verticalAlign: "2px" }}
        />
      )}
      {formatDuration(durationMs)}
    </span>
  );

  return (
    <div className="relative flex flex-col gap-0.5 px-4 py-3 before:absolute before:top-0 before:right-5 before:left-5 before:h-px before:bg-border-soft first:before:hidden md:flex-row md:items-center md:gap-4 md:px-5 md:py-2.5">
      {/* мобайл: номера заявок + длительность */}
      <div className="flex items-baseline gap-1 text-xs text-muted-foreground tabular-nums md:hidden">
        <span>{mobileNums || "без заявки"}</span>
        <span className="ms-auto text-sm">{duration}</span>
      </div>

      {/* десктоп: колонка номеров-ссылок */}
      <div className="hidden w-20 flex-none flex-col gap-0.5 text-sm leading-tight md:flex">
        {(work.tickets || []).map((ticket) => (
          <TicketLink key={ticket._id} ticket={ticket} />
        ))}
        {!work.tickets?.length && <span className="text-faint">—</span>}
      </div>

      {/* описание + мета */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{work.description || "—"}</div>
        <div className="hidden truncate text-sm text-muted-foreground md:block">
          {desktopMeta || "—"}
        </div>
      </div>

      {/* десктоп: исполнитель */}
      <div className="hidden w-42 flex-none truncate text-sm text-muted-foreground lg:block">
        {executorName(work.finishedBy)}
      </div>

      {/* десктоп: длительность + дата завершения */}
      <div className="hidden w-44 flex-none text-right tabular-nums md:block">
        <div className="text-sm">{duration}</div>
        <div className="text-xs text-faint">
          завершена {formatShortDate(work.finishedAt)}
        </div>
      </div>

      {/* мобайл: компания · исполнитель */}
      <div className="truncate text-sm text-muted-foreground md:hidden">
        {mobileMeta || "—"}
      </div>
    </div>
  );
};

export default WorkArchiveItem;
