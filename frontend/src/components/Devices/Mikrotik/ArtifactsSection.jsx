import { useCallback, useEffect, useState } from "react";

import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Table from "react-bootstrap/Table";
import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Spinner from "react-bootstrap/Spinner";
import Form from "react-bootstrap/Form";

import {
  RiCalendarScheduleLine,
  RiSaveLine,
  RiAddLine,
  RiDownloadLine,
  RiDeleteBinLine,
  RiCloudLine,
  RiHardDrive2Line,
  RiMailLockLine,
} from "react-icons/ri";

import SchedulePresetFields from "./SchedulePresetFields";
import ConfirmActionModal from "../../../UI/ConfirmActionModal";

import { formatDate } from "../../../util/format-date";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";
import useToastStore from "../../../store/toast-store";

const formatBytes = (bytes) => {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
};

const scheduleFields = (schedule) => ({
  frequency: schedule?.frequency || "off",
  time: schedule?.time || "03:00",
  weekday: schedule?.weekday ?? 1,
  dayOfMonth: schedule?.dayOfMonth ?? 1,
  keepLast: schedule?.keepLast ?? 10,
});

const WEEKDAYS = [
  "воскресеньям",
  "понедельникам",
  "вторникам",
  "средам",
  "четвергам",
  "пятницам",
  "субботам",
];

// One-line Russian description of a schedule preset for the collapsed summary.
const describeSchedule = (s) => {
  if (s.frequency === "daily") return `Ежедневно в ${s.time}`;
  if (s.frequency === "weekly")
    return `Еженедельно по ${WEEKDAYS[s.weekday] || WEEKDAYS[1]} в ${s.time}`;
  if (s.frequency === "monthly")
    return `Ежемесячно ${s.dayOfMonth}-го числа в ${s.time}`;
  return "Выключено";
};

// Config-export (.rsc) management for one device: schedule + retention, manual
// creation, and the stored copies. Binary backups aren't offered — RouterOS's
// SSH can't serve a binary file (see services/mikrotik/artifacts.js).
const ArtifactsSection = ({ recordId, type, initialSchedule, canManage }) => {
  const createLabel = "Экспортировать сейчас";
  const createSuccess = "Конфигурация экспортирована";
  const emptyText = "Экспортов конфигурации пока нет";

  const fetchArtifacts = useMikrotikDeviceFilterStore(
    (state) => state.fetchArtifacts,
  );
  const createExport = useMikrotikDeviceFilterStore(
    (state) => state.createExport,
  );
  const deleteArtifact = useMikrotikDeviceFilterStore(
    (state) => state.deleteArtifact,
  );
  const saveSchedules = useMikrotikDeviceFilterStore(
    (state) => state.saveSchedules,
  );
  const downloadArtifact = useMikrotikDeviceFilterStore(
    (state) => state.downloadArtifact,
  );
  const requestDownloadCode = useMikrotikDeviceFilterStore(
    (state) => state.requestDownloadCode,
  );
  const patchRow = useMikrotikDeviceFilterStore((state) => state.patchRow);
  const showToast = useToastStore((state) => state.showToast);

  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [schedule, setSchedule] = useState(scheduleFields(initialSchedule));
  const [savedSchedule, setSavedSchedule] = useState(
    scheduleFields(initialSchedule),
  );
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [meta, setMeta] = useState({
    lastSuccessAt: initialSchedule?.lastSuccessAt || null,
    lastError: initialSchedule?.lastError || null,
    nextRunAt: initialSchedule?.nextRunAt || null,
  });
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Two-factor download: an emailed 6-digit code gates the fetch.
  const [downloadTarget, setDownloadTarget] = useState(null);
  const [downloadCode, setDownloadCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    const list = await fetchArtifacts(recordId, type);
    setArtifacts(list);
    setLoading(false);
  }, [fetchArtifacts, recordId, type]);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const response = await createExport(recordId);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showToast(
          "danger text-white",
          data.message || "Не удалось выполнить операцию",
        );
        return;
      }
      const data = await response.json().catch(() => ({}));
      patchRow(recordId, {
        lastExportAt: data.artifact?.createdAt || new Date().toISOString(),
      });
      showToast("success text-white", createSuccess);
      await loadArtifacts();
    } finally {
      setCreating(false);
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const response = await saveSchedules(recordId, { [type]: schedule });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showToast(
          "danger text-white",
          data.message || "Не удалось сохранить расписание",
        );
        return;
      }
      const data = await response.json().catch(() => ({}));
      const saved = data.schedules?.[type];
      if (saved) {
        setMeta({
          lastSuccessAt: saved.lastSuccessAt || null,
          lastError: saved.lastError || null,
          nextRunAt: saved.nextRunAt || null,
        });
      }
      if (data.schedules) {
        patchRow(recordId, { schedules: data.schedules });
      }
      setSavedSchedule(schedule);
      setEditingSchedule(false);
      showToast("success text-white", "Расписание сохранено");
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleCancelSchedule = () => {
    setSchedule(savedSchedule);
    setEditingSchedule(false);
  };

  // Step 1: request an emailed code and open the entry modal.
  const openDownload = async (artifact) => {
    setDownloadCode("");
    setDownloadTarget(artifact);
    setSendingCode(true);
    try {
      const response = await requestDownloadCode(recordId, artifact.id);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast("danger text-white", data.message || "Не удалось отправить код");
        setDownloadTarget(null);
        return;
      }
      showToast("success text-white", data.message || "Код отправлен на почту");
    } finally {
      setSendingCode(false);
    }
  };

  const resendDownloadCode = async () => {
    if (!downloadTarget) return;
    setSendingCode(true);
    try {
      const response = await requestDownloadCode(recordId, downloadTarget.id);
      const data = await response.json().catch(() => ({}));
      showToast(
        response.ok ? "success text-white" : "danger text-white",
        data.message || (response.ok ? "Код отправлен" : "Не удалось отправить код"),
      );
    } finally {
      setSendingCode(false);
    }
  };

  // Step 2: submit the code; the store streams the file on success.
  const handleVerifyDownload = async () => {
    if (!downloadTarget || downloadCode.length !== 6) return;
    setVerifying(true);
    try {
      const response = await downloadArtifact(
        recordId,
        downloadTarget.id,
        downloadTarget.fileName,
        downloadCode,
      );
      if (response && !response.ok) {
        const data = await response.json().catch(() => ({}));
        showToast("danger text-white", data.message || "Не удалось скачать файл");
        return;
      }
      setDownloadTarget(null);
      showToast("success text-white", "Файл скачан");
    } finally {
      setVerifying(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await deleteArtifact(recordId, deleteTarget.id);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showToast("danger text-white", data.message || "Не удалось удалить");
        return;
      }
      const remaining = artifacts.filter((item) => item.id !== deleteTarget.id);
      setDeleteTarget(null);
      setArtifacts(remaining);
      // Backend returns copies newest-first, so remaining[0] is the new latest.
      patchRow(recordId, { lastExportAt: remaining[0]?.createdAt || null });
      showToast("success text-white", "Копия удалена");
    } finally {
      setDeleting(false);
    }
  };

  const savedOff = savedSchedule.frequency === "off";

  return (
    <div className="pt-3">
      <Card className="border-0 shadow-sm mb-3">
        <Card.Header className="cap-card-title bg-transparent">
          <RiCalendarScheduleLine />
          <span>Расписание</span>
        </Card.Header>
        <Card.Body>
          {editingSchedule ? (
            <>
              <SchedulePresetFields
                value={schedule}
                onChange={setSchedule}
                disabled={savingSchedule}
              />
              <div className="d-flex justify-content-end gap-2 mt-3">
                <Button
                  variant="link"
                  size="sm"
                  className="text-body-secondary"
                  onClick={handleCancelSchedule}
                  disabled={savingSchedule}
                >
                  Отмена
                </Button>
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={handleSaveSchedule}
                  disabled={savingSchedule}
                >
                  {savingSchedule ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <RiSaveLine />
                  )}{" "}
                  Сохранить
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="d-flex justify-content-between align-items-start gap-2">
                <div style={{ minWidth: 0 }}>
                  <div className="fw-medium">
                    {describeSchedule(savedSchedule)}
                  </div>
                  {!savedOff && (
                    <div className="small text-muted">
                      Хранить последних: {savedSchedule.keepLast}
                    </div>
                  )}
                </div>
                {canManage && (
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 text-nowrap flex-shrink-0"
                    onClick={() => setEditingSchedule(true)}
                  >
                    {savedOff ? "Настроить" : "Изменить"}
                  </Button>
                )}
              </div>

              {!savedOff &&
                (meta.nextRunAt || meta.lastSuccessAt || meta.lastError) && (
                  <div className="small text-muted mt-2">
                    {meta.nextRunAt && (
                      <div>Следующий запуск: {formatDate(meta.nextRunAt)}</div>
                    )}
                    {meta.lastSuccessAt && (
                      <div>
                        Последний успешный: {formatDate(meta.lastSuccessAt)}
                      </div>
                    )}
                    {meta.lastError && (
                      <div className="text-danger">Ошибка: {meta.lastError}</div>
                    )}
                  </div>
                )}
            </>
          )}
        </Card.Body>
      </Card>

      {canManage && (
        <div className="d-flex justify-content-end mb-3">
          <Button variant="primary" onClick={handleCreate} disabled={creating}>
            {creating ? <Spinner animation="border" size="sm" /> : <RiAddLine />}{" "}
            {createLabel}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="text-center text-muted py-3">
          <Spinner animation="border" size="sm" />
        </div>
      ) : artifacts.length === 0 ? (
        <Alert variant="light" className="text-center text-muted mb-0">
          {emptyText}
        </Alert>
      ) : (
        <Table responsive hover size="sm" className="align-middle mb-0">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Размер</th>
              <th className="text-end">Действия</th>
            </tr>
          </thead>
          <tbody>
            {artifacts.map((artifact) => (
              <tr key={artifact.id}>
                <td data-cell="Дата">
                  <div>{formatDate(artifact.createdAt)}</div>
                  <div className="small text-muted d-flex align-items-center gap-2">
                    {artifact.storage === "s3" ? (
                      <span className="d-inline-flex align-items-center gap-1">
                        <RiCloudLine /> Облако
                      </span>
                    ) : (
                      <span className="d-inline-flex align-items-center gap-1">
                        <RiHardDrive2Line /> Локально
                      </span>
                    )}
                    {artifact.trigger === "scheduled" && (
                      <Badge bg="secondary" pill>
                        По расписанию
                      </Badge>
                    )}
                  </div>
                </td>
                <td data-cell="Размер" className="text-nowrap">
                  {formatBytes(artifact.size)}
                </td>
                <td data-cell="Действия" className="text-end text-nowrap">
                  {canManage ? (
                    <>
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        className="me-1"
                        onClick={() => openDownload(artifact)}
                        disabled={sendingCode || verifying}
                        title="Скачать"
                        aria-label="Скачать"
                      >
                        <RiDownloadLine />
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => setDeleteTarget(artifact)}
                        title="Удалить"
                        aria-label="Удалить"
                      >
                        <RiDeleteBinLine />
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <ConfirmActionModal
        show={!!deleteTarget}
        onHide={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Удалить копию"
        body={
          <>
            Файл <strong>{deleteTarget?.fileName}</strong> будет удалён
            безвозвратно.
          </>
        }
        confirmLabel="Удалить"
        confirmVariant="danger"
        isLoading={deleting}
      />

      <ConfirmActionModal
        show={!!downloadTarget}
        onHide={() => setDownloadTarget(null)}
        onConfirm={handleVerifyDownload}
        title="Подтверждение скачивания"
        body={
          <div>
            <p className="d-flex align-items-start gap-2 mb-3 text-body-secondary">
              <RiMailLockLine className="text-success flex-shrink-0 mt-1" />
              <span>
                Мы отправили одноразовый код на вашу почту. Введите его, чтобы
                скачать <strong>{downloadTarget?.fileName}</strong>.
              </span>
            </p>
            <Form.Control
              autoFocus
              value={downloadCode}
              onChange={(event) =>
                setDownloadCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && downloadCode.length === 6) {
                  handleVerifyDownload();
                }
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="______"
              className="text-center font-monospace fs-4"
              style={{ letterSpacing: "0.4em" }}
            />
            <div className="mt-2 small text-muted">
              Код действует 10 минут.{" "}
              <Button
                variant="link"
                size="sm"
                className="p-0 align-baseline"
                onClick={resendDownloadCode}
                disabled={sendingCode}
              >
                {sendingCode ? "Отправляем…" : "Отправить новый код"}
              </Button>
            </div>
          </div>
        }
        confirmLabel="Скачать"
        confirmVariant="primary"
        isLoading={verifying}
      />
    </div>
  );
};

export default ArtifactsSection;
