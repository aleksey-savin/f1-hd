import Badge from "react-bootstrap/Badge";
import { RiDeleteBin6Line, RiShieldKeyholeLine } from "react-icons/ri";

import { getApprovalMeta } from "../../util/knowledgeNoteTypes";

// Бейджи статуса модерации заметки: одобрение, ожидание удаления, найденные
// секреты. showApproval=false — скрыть бейдж одобрения (например, когда включено
// «скрывать неодобренные» и в выдаче заведомо только одобренные заметки).
const NoteStatusBadges = ({ note, showApproval = true, className = "" }) => {
  if (!note) {
    return null;
  }

  const approval = getApprovalMeta(note);
  const ApprovalIcon = approval.icon;

  return (
    <>
      {showApproval && (
        <Badge bg={approval.bg} className={className}>
          <ApprovalIcon /> {approval.label}
        </Badge>
      )}
      {note.pendingDeletion && (
        <Badge bg="danger" className={className}>
          <RiDeleteBin6Line /> На удалении
        </Badge>
      )}
      {note.secretsScan?.flagged && (
        <Badge bg="danger" className={className}>
          <RiShieldKeyholeLine /> Секреты
        </Badge>
      )}
    </>
  );
};

export default NoteStatusBadges;
