import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import ListGroup from "react-bootstrap/ListGroup";

import { RiShieldKeyholeLine } from "react-icons/ri";

// Находки сканера учётных данных — только модератору. Сырой секрет не хранится:
// показываем замаскированный фрагмент. «Не секрет» запоминает хэш значения, а не
// текст, поэтому другой реальный секрет в той же заметке сработает снова.
const SecretsAlert = ({ note, isModerator, isLoading, onIgnore }) => {
  const findings = note?.secretsScan?.findings || [];

  if (!isModerator || !note?.secretsScan?.flagged || findings.length === 0) {
    return null;
  }

  return (
    <Alert variant="danger" className="mb-3">
      <div className="fw-semibold mb-2">
        <RiShieldKeyholeLine aria-hidden="true" /> Возможные учётные данные
      </div>
      <ListGroup variant="flush">
        {findings.map((finding, index) => (
          <ListGroup.Item
            key={finding.hash || index}
            className="d-flex flex-wrap align-items-center gap-2 bg-transparent px-0 border-0 py-1"
          >
            <span className="font-monospace">{finding.maskedSnippet}</span>
            <Button
              size="sm"
              variant="outline-secondary"
              className="alert-action-btn ms-auto"
              disabled={isLoading}
              onClick={() => onIgnore(finding.hash)}
            >
              Не секрет
            </Button>
          </ListGroup.Item>
        ))}
      </ListGroup>
    </Alert>
  );
};

export default SecretsAlert;
