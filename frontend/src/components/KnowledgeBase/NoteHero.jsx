import { cn } from "@/lib/utils";

import { getNoteTypeMeta } from "../../util/knowledgeNoteTypes";
import VerificationLine from "./VerificationLine";

// Шапка заметки по канону карточки сущности: плитка-глиф · заголовок · строка
// доверия · кластер действий справа. Заголовок в правке — тот же h1 с теми же
// метриками, только редактируемый: переключение режима не сдвигает текст.
const NoteHero = ({
  note,
  isNew,
  isEditing,
  title,
  type,
  onTitleChange,
  actions,
}) => {
  const typeMeta = getNoteTypeMeta(type);
  const TypeIcon = typeMeta.icon;
  const archived = !!note?.archivedAt;

  return (
    <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-4">
      <span
        aria-hidden
        title={typeMeta.label}
        className={cn(
          "tw:grid tw:size-14 tw:flex-none tw:place-items-center tw:rounded-2xl tw:text-2xl",
          archived
            ? "tw:text-faint"
            : "tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border",
        )}
      >
        <TypeIcon />
      </span>

      <div className="tw:min-w-0 tw:flex-1">
        {isEditing ? (
          <input
            type="text"
            autoFocus={isNew}
            aria-label="Заголовок заметки"
            placeholder="Заголовок заметки"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            // Метрики совпадают с h1 ниже; рамка только снизу — поле не должно
            // выглядеть «коробкой» посреди документа (preflight выключен,
            // поэтому appearance/border/bg задаём явно)
            className="tw:w-full tw:appearance-none tw:border-0 tw:bg-transparent tw:p-0 tw:text-3xl tw:leading-tight tw:font-semibold tw:tracking-tight tw:text-foreground tw:outline-none tw:placeholder:text-faint"
            style={{ borderBottom: "1px solid var(--border)" }}
          />
        ) : (
          <h1
            className={cn(
              "tw:my-0 tw:text-3xl tw:leading-tight tw:font-semibold tw:tracking-tight tw:break-words",
              archived && "tw:text-muted-foreground",
            )}
          >
            {note?.title}
          </h1>
        )}

        {!isNew && (
          <div className="tw:mt-2">
            {archived && !isEditing ? (
              <p className="tw:my-0 tw:text-sm tw:text-muted-foreground">
                В архиве — только для чтения
              </p>
            ) : (
              <VerificationLine note={note} isEditing={isEditing} />
            )}
          </div>
        )}
      </div>

      {actions && (
        <div className="tw:flex tw:flex-none tw:items-center tw:gap-2">
          {actions}
        </div>
      )}
    </div>
  );
};

export default NoteHero;
