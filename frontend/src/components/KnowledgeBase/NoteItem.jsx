import { Link } from "react-router";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import useInitialPrefsStore from "../../store/prefs";
import { formatShortDate } from "../../util/format-date";
import { getNoteFlags, getNoteTypeMeta } from "../../util/knowledgeNoteTypes";

const TONE_CLASS = {
  danger: "tw:text-destructive",
  warning: "tw:text-warning",
  faint: "tw:text-faint",
};

// Строка списка заметок в рейле (и в плоском списке на мобилке).
//
// Тип несёт иконка слева, состояние — значки справа, и только исключения:
// проверенная заметка не показывает ничего, потому что это норма, а место в
// колонке 344 px дороже подтверждения нормы (docs/ux-ui-guide.md).
//
// В очереди модерации строка выделяется, а не открывается: клик по ней ставит
// галочку, а заголовок остаётся ссылкой на заметку. Поэтому в этом режиме
// корень строки — div (кнопка-чекбокс внутри ссылки — недопустимая вложенность).
const NoteItem = ({
  note,
  isActive,
  selectable = false,
  isSelected = false,
  onToggleSelected,
  showCompanies = true,
  nested = false,
}) => {
  const approvalPeriodDays = useInitialPrefsStore(
    (state) => state.knowledgeBase.approvalPeriodDays,
  );

  const typeMeta = getNoteTypeMeta(note.type);
  const TypeIcon = typeMeta.icon;
  const flags = getNoteFlags(note, { approvalPeriodDays });

  const companies = (note.companies || []).map((company) => company.alias);
  const meta = [
    typeMeta.label,
    showCompanies && companies.length ? companies.join(", ") : null,
    note.updatedAt ? formatShortDate(note.updatedAt) : null,
  ].filter(Boolean);

  const rowClass = cn(
    "tw:relative tw:flex tw:items-start tw:gap-2.5 tw:py-2.5 tw:pe-3.5 tw:text-foreground tw:no-underline tw:transition-colors",
    "tw:before:absolute tw:before:top-0 tw:before:right-3.5 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden",
    nested ? "tw:ps-8 tw:before:left-8" : "tw:ps-3.5 tw:before:left-3.5",
    isActive ? "tw:bg-primary/10" : "tw:hover:bg-accent/60",
    selectable && "tw:cursor-pointer",
    note.archivedAt && "tw:text-muted-foreground",
  );

  // Полоса выбранной строки — односторонняя граница инлайном: без preflight
  // односторонние border-утилиты рисуются ненадёжно (правила миграции в гайде)
  const rowStyle = {
    borderLeft: `2px solid ${isActive ? "var(--primary)" : "transparent"}`,
  };

  const body = (
    <>
      <span className="tw:min-w-0 tw:flex-1">
        <span
          className={cn(
            "tw:block tw:truncate tw:text-base tw:leading-snug",
            isActive ? "tw:font-semibold" : "tw:font-medium",
          )}
        >
          {note.title}
        </span>
        <span className="tw:block tw:truncate tw:text-sm tw:text-muted-foreground tw:tabular-nums">
          {meta.join(" · ")}
        </span>
      </span>

      {flags.length > 0 && (
        <span className="tw:mt-0.5 tw:flex tw:flex-none tw:items-center tw:gap-1.5">
          {flags.map(({ key, icon: Icon, tone, title }) => (
            <Icon
              key={key}
              size={16}
              title={title}
              aria-label={title}
              className={TONE_CLASS[tone]}
            />
          ))}
        </span>
      )}
    </>
  );

  if (selectable) {
    return (
      <div
        className={rowClass}
        style={rowStyle}
        onClick={() => onToggleSelected(note._id)}
      >
        <span className="tw:mt-0.5 tw:flex-none">
          <Checkbox
            checked={isSelected}
            aria-label={`Выделить заметку «${note.title}»`}
            onCheckedChange={() => onToggleSelected(note._id)}
            onClick={(event) => event.stopPropagation()}
          />
        </span>
        <Link
          to={`/knowledge-base/${note._id}`}
          onClick={(event) => event.stopPropagation()}
          className="tw:flex tw:min-w-0 tw:flex-1 tw:items-start tw:gap-2.5 tw:text-inherit tw:no-underline"
        >
          {body}
        </Link>
      </div>
    );
  }

  return (
    <Link to={`/knowledge-base/${note._id}`} className={rowClass} style={rowStyle}>
      <TypeIcon
        size={18}
        aria-hidden
        title={typeMeta.label}
        className={cn(
          "tw:mt-0.5 tw:flex-none",
          isActive ? "tw:text-accent-text" : "tw:text-faint",
        )}
      />
      {body}
    </Link>
  );
};

export default NoteItem;
