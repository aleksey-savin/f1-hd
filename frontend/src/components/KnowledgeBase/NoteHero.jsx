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
    <div className="flex flex-wrap items-start gap-4">
      <span
        aria-hidden
        title={typeMeta.label}
        className={cn(
          "grid size-14 flex-none place-items-center rounded-2xl text-2xl",
          archived
            ? "text-faint"
            : "bg-accent text-muted-foreground inset-ring inset-ring-border",
        )}
      >
        <TypeIcon />
      </span>

      <div className="min-w-0 flex-1">
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
            className="w-full appearance-none border-0 bg-transparent p-0 text-3xl leading-tight font-semibold tracking-tight text-foreground outline-none placeholder:text-faint"
            style={{ borderBottom: "1px solid var(--border)" }}
          />
        ) : (
          <h1
            className={cn(
              "my-0 text-3xl leading-tight font-semibold tracking-tight break-words",
              archived && "text-muted-foreground",
            )}
          >
            {note?.title}
          </h1>
        )}

        {!isNew && (
          <div className="mt-2">
            {archived && !isEditing ? (
              <p className="my-0 text-sm text-muted-foreground">
                В архиве — только для чтения
              </p>
            ) : (
              <VerificationLine note={note} isEditing={isEditing} />
            )}
          </div>
        )}
      </div>

      {actions && (
        <div className="flex flex-none items-center gap-2">{actions}</div>
      )}
    </div>
  );
};

export default NoteHero;
