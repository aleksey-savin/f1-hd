import { Link } from "react-router";

import Badge from "react-bootstrap/Badge";
import Form from "react-bootstrap/Form";
import ListGroup from "react-bootstrap/ListGroup";

import {
  RiDeleteBin6Line,
  RiShieldKeyholeLine,
  RiArchiveLine,
} from "react-icons/ri";

import { formatShortDate } from "../../util/format-date";
import { getApprovalMeta, getNoteTypeMeta } from "../../util/knowledgeNoteTypes";

import "../../UI/knowledgeBase.css";

// Строка списка заметок: состояние проверки иконкой, заголовок, под ним — тип,
// компании и дата изменения. Чекбокс появляется только в очереди модерации,
// где выделение имеет смысл.
const NoteItem = ({
  note,
  isActive,
  selectable = false,
  isSelected = false,
  onToggleSelected,
  showCompanies = true,
}) => {
  const approval = getApprovalMeta(note);
  const ApprovalIcon = approval.icon;
  const typeMeta = getNoteTypeMeta(note.type);

  const companies = note.companies || [];

  return (
    <ListGroup.Item
      action
      as={Link}
      to={`/knowledge-base/${note._id}`}
      active={isActive}
      className="kb-item"
    >
      {selectable && (
        <Form.Check
          className="kb-item__check"
          checked={isSelected}
          aria-label={`Выделить заметку «${note.title}»`}
          onChange={() => onToggleSelected(note._id)}
          // Клик по чекбоксу не должен открывать заметку
          onClick={(event) => event.stopPropagation()}
        />
      )}

      <ApprovalIcon
        className={`kb-item__approval text-${approval.bg}`}
        title={approval.label}
        aria-label={approval.label}
      />

      <div className="kb-item__body">
        <div className="kb-item__title">{note.title}</div>
        <div className="kb-item__meta">
          <span className={`kb-item__type text-${typeMeta.badge}`}>
            {typeMeta.label}
          </span>
          {showCompanies &&
            companies.map((company) => (
              <span key={company._id}>{company.alias}</span>
            ))}
          {note.updatedAt && <span>{formatShortDate(note.updatedAt)}</span>}
        </div>
      </div>

      {(note.pendingDeletion ||
        note.pendingArchive ||
        note.secretsScan?.flagged) && (
        <span className="kb-item__flags">
          {note.secretsScan?.flagged && (
            <RiShieldKeyholeLine
              className="text-warning"
              title="Найдены учётные данные"
            />
          )}
          {note.pendingArchive && (
            <RiArchiveLine className="text-secondary" title="Ожидает архивации" />
          )}
          {note.pendingDeletion && (
            <RiDeleteBin6Line className="text-danger" title="На удалении" />
          )}
        </span>
      )}

      {note.archivedAt && (
        <Badge bg="dark" className="flex-shrink-0">
          Архив
        </Badge>
      )}
    </ListGroup.Item>
  );
};

export default NoteItem;
