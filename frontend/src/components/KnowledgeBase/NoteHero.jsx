import Form from "react-bootstrap/Form";

import { getNoteTypeMeta } from "../../util/knowledgeNoteTypes";
import NoteStatusBadges from "./NoteStatusBadges";
import VerificationLine from "./VerificationLine";

import "../../UI/knowledgeBase.css";

// Шапка заметки по образцу .account-hero со страницы устройства: плитка-глиф
// слева, заголовок и строка доверия по центру, кластер действий справа.
// Заголовок в правке — тот же h2, только редактируемый: метрики совпадают,
// поэтому переключение режима не сдвигает текст.
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

  return (
    <div className="note-hero mb-3">
      <span
        className={`note-type-tile note-type-tile--${typeMeta.badge}`}
        title={typeMeta.label}
      >
        <TypeIcon aria-hidden="true" />
      </span>

      <div className="flex-grow-1" style={{ minWidth: 0 }}>
        {isEditing ? (
          <Form.Control
            autoFocus={isNew}
            type="text"
            aria-label="Заголовок заметки"
            placeholder="Заголовок заметки"
            className="kb-title-input mb-1"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        ) : (
          <h2 className="kb-title mb-1 text-break">{note?.title}</h2>
        )}

        {!isNew && <VerificationLine note={note} isEditing={isEditing} />}

        {!isEditing && (
          <div className="d-flex flex-wrap gap-1 mt-2">
            <NoteStatusBadges note={note} />
          </div>
        )}
      </div>

      <div className="note-hero__actions">{actions}</div>
    </div>
  );
};

export default NoteHero;
