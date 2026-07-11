import Modal from "react-bootstrap/Modal";
import Badge from "react-bootstrap/Badge";

import { RiExternalLinkLine } from "react-icons/ri";

// Детали уязвимостей прошивки: список CVE (по убыванию CVSS) со ссылками на NVD.
// Модалка рендерится в портале, но React-события всплывают по дереву компонентов —
// гасим клики/клавиши, чтобы они не дошли до кликабельной строки таблицы.
const CveModal = ({ show, onClose, status, displayName }) => {
  if (!status) return null;

  return (
    <Modal
      centered
      show={show}
      onHide={onClose}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Modal.Header closeButton>
        <Modal.Title className="fs-5">Уязвимости: {displayName}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-body-secondary">
          Установлена версия{" "}
          <span className="font-monospace">{status.installedVersion}</span> —
          обновление до{" "}
          <span className="font-monospace">{status.latestVersion}</span>{" "}
          устраняет перечисленные уязвимости.
        </p>
        {status.cves.map((cve) => (
          <div key={cve.id} className="mb-3">
            <div className="d-flex align-items-center gap-2">
              <a
                href={`https://nvd.nist.gov/vuln/detail/${cve.id}`}
                target="_blank"
                rel="noreferrer"
                className="fw-semibold"
              >
                {cve.id} <RiExternalLinkLine />
              </a>
              <Badge
                bg={cve.severity === "CRITICAL" ? "danger" : "warning"}
                text={cve.severity === "CRITICAL" ? undefined : "dark"}
              >
                {cve.severity || "—"} {cve.score ?? ""}
              </Badge>
            </div>
            {cve.description && (
              <div className="small text-body-secondary mt-1">
                {cve.description}
              </div>
            )}
          </div>
        ))}
      </Modal.Body>
    </Modal>
  );
};

export default CveModal;
