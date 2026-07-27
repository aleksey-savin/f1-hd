import { formatShortDate } from "../../util/format-date";

import { LONG_WORK_MS, formatDuration } from "./duration";

// Строка архива работ (read-only): №-ссылки связанных заявок · описание + мета
// «компания · категории · инициаторы» · исполнитель · длительность и дата
// завершения. Сама строка никуда не ведёт (у работы нет карточки) —
// кликабельны только номера заявок (новая вкладка, выдача остаётся на месте).
// Длительность от 12 часов — warning-текст с точкой, строка не заливается.
// На мобайле — три яруса: №№ + длительность / описание / компания · исполнитель.

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
    className="tw:font-medium tw:text-accent-text tw:tabular-nums tw:no-underline tw:hover:underline"
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
  const mobileNums = (work.tickets || []).map((ticket) => ticket.num).join(" · ");

  const duration = (
    <span
      className={isLong ? "tw:font-semibold tw:text-warning" : "tw:font-semibold"}
      title={isLong ? "Длительность больше 12 часов" : undefined}
    >
      {isLong && (
        <span
          aria-hidden
          className="tw:me-1.5 tw:inline-block tw:size-1.5 tw:rounded-full tw:bg-warning"
          style={{ verticalAlign: "2px" }}
        />
      )}
      {formatDuration(durationMs)}
    </span>
  );

  return (
    <div className="tw:relative tw:flex tw:flex-col tw:gap-0.5 tw:px-4 tw:py-3 tw:before:absolute tw:before:top-0 tw:before:right-5 tw:before:left-5 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden tw:md:flex-row tw:md:items-center tw:md:gap-4 tw:md:px-5 tw:md:py-2.5">
      {/* мобайл: №№ заявок + длительность */}
      <div className="tw:flex tw:items-baseline tw:gap-1 tw:text-xs tw:text-muted-foreground tw:tabular-nums tw:md:hidden">
        <span>{mobileNums ? `№ ${mobileNums}` : "без заявки"}</span>
        <span className="tw:ms-auto tw:text-sm">{duration}</span>
      </div>

      {/* десктоп: колонка №-ссылок */}
      <div className="tw:hidden tw:w-20 tw:flex-none tw:flex-col tw:gap-0.5 tw:text-sm tw:leading-tight tw:md:flex">
        {(work.tickets || []).map((ticket) => (
          <TicketLink key={ticket._id} ticket={ticket} />
        ))}
        {!work.tickets?.length && <span className="tw:text-faint">—</span>}
      </div>

      {/* описание + мета */}
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:truncate tw:font-medium">
          {work.description || "—"}
        </div>
        <div className="tw:hidden tw:truncate tw:text-sm tw:text-muted-foreground tw:md:block">
          {desktopMeta || "—"}
        </div>
      </div>

      {/* десктоп: исполнитель */}
      <div className="tw:hidden tw:w-42 tw:flex-none tw:truncate tw:text-sm tw:text-muted-foreground tw:lg:block">
        {executorName(work.finishedBy)}
      </div>

      {/* десктоп: длительность + дата завершения */}
      <div className="tw:hidden tw:w-44 tw:flex-none tw:text-right tw:tabular-nums tw:md:block">
        <div className="tw:text-sm">{duration}</div>
        <div className="tw:text-xs tw:text-faint">
          завершена {formatShortDate(work.finishedAt)}
        </div>
      </div>

      {/* мобайл: компания · исполнитель */}
      <div className="tw:truncate tw:text-sm tw:text-muted-foreground tw:md:hidden">
        {mobileMeta || "—"}
      </div>
    </div>
  );
};

export default WorkArchiveItem;
