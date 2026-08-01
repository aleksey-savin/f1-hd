import { Link } from "react-router";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import useInitialPrefsStore from "../../store/prefs";
import { formatShortDate } from "../../util/format-date";
import { getNoteFlags, getNoteTypeMeta } from "../../util/knowledgeNoteTypes";

const TONE_CLASS = {
  danger: "text-destructive",
  warning: "text-warning",
  faint: "text-faint",
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
    "relative flex items-start gap-2.5 py-2.5 pe-3.5 text-foreground no-underline transition-colors",
    "before:absolute before:top-0 before:right-3.5 before:h-px before:bg-border-soft first:before:hidden",
    nested ? "ps-8 before:left-8" : "ps-3.5 before:left-3.5",
    isActive ? "bg-primary/10" : "hover:bg-accent/60",
    selectable && "cursor-pointer",
    note.archivedAt && "text-muted-foreground",
  );

  // Полоса выбранной строки — односторонняя граница инлайном: без preflight
  // односторонние border-утилиты рисуются ненадёжно (правила миграции в гайде)
  const rowStyle = {
    borderLeft: `2px solid ${isActive ? "var(--primary)" : "transparent"}`,
  };

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-base leading-snug",
            isActive ? "font-semibold" : "font-medium",
          )}
        >
          {note.title}
        </span>
        <span className="block truncate text-sm text-muted-foreground tabular-nums">
          {meta.join(" · ")}
        </span>
      </span>

      {flags.length > 0 && (
        <span className="mt-0.5 flex flex-none items-center gap-1.5">
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
        <span className="mt-0.5 flex-none">
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
          className="flex min-w-0 flex-1 items-start gap-2.5 text-inherit no-underline"
        >
          {body}
        </Link>
      </div>
    );
  }

  return (
    <Link
      to={`/knowledge-base/${note._id}`}
      className={rowClass}
      style={rowStyle}
    >
      <TypeIcon
        size={18}
        aria-hidden
        title={typeMeta.label}
        className={cn(
          "mt-0.5 flex-none",
          isActive ? "text-accent-text" : "text-faint",
        )}
      />
      {body}
    </Link>
  );
};

export default NoteItem;
