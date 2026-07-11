import { useEffect, useState } from "react";

import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Offcanvas from "react-bootstrap/Offcanvas";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";

import { RiErrorWarningLine, RiExternalLinkLine } from "react-icons/ri";

import { formatDate } from "../../../util/format-date";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

const BRANCH_LABEL = {
  "7.stable": "stable",
  "7.long-term": "long-term",
  "6.stable": "stable (v6)",
  "6.long-term": "long-term (v6)",
};
const BRANCH_ORDER = ["7.stable", "7.long-term", "6.stable", "6.long-term"];

// Плашка «последние версии RouterOS» над таблицей. Чипы v7 — всегда, чипы v6 —
// только когда во флоте есть устройства соответствующей ветки. Клик по чипу —
// offcanvas с датой выхода, счётчиком отстающих и чейнджлогом. Пока кэш пуст
// (первый деплой до boot-рефреша) плашка не рендерится вовсе.
const RouterOsReleasesStrip = () => {
  const releases = useMikrotikDeviceFilterStore((state) => state.releases);
  const fetchReleases = useMikrotikDeviceFilterStore(
    (state) => state.fetchReleases,
  );
  const originalList = useMikrotikDeviceFilterStore(
    (state) => state.originalList,
  );

  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);

  const channels = releases?.channels || [];
  const byKey = new Map(channels.map((channel) => [channel.key, channel]));

  const fleetBranches = new Set(
    (originalList || [])
      .map((row) => row.firmwareStatus?.branchKey)
      .filter(Boolean),
  );

  const visible = BRANCH_ORDER.filter((key) => {
    if (!byKey.get(key)?.version) return false;
    return key.startsWith("6.") ? fleetBranches.has(key) : true;
  });
  if (!visible.length) return null;

  const branchStats = (key) => {
    const rows = (originalList || []).filter(
      (row) => row.firmwareStatus?.branchKey === key,
    );
    return {
      total: rows.length,
      behind: rows.filter((row) => row.firmwareStatus.updateAvailable).length,
    };
  };

  const newestFetch = channels.reduce(
    (max, channel) =>
      channel.fetchedAt && (!max || channel.fetchedAt > max)
        ? channel.fetchedAt
        : max,
    null,
  );
  const hasError =
    channels.some((channel) => channel.lastError) ||
    Boolean(releases?.cveSync?.lastError);

  const open = openKey ? byKey.get(openKey) : null;
  const openStats = openKey ? branchStats(openKey) : null;

  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <span className="text-body-secondary small">RouterOS:</span>
        {visible.map((key) => {
          const channel = byKey.get(key);
          const { behind } = branchStats(key);
          return (
            <Button
              key={key}
              size="sm"
              variant="outline-secondary"
              onClick={() => setOpenKey(key)}
            >
              {BRANCH_LABEL[key]}{" "}
              <span className="font-monospace fw-semibold">
                {channel.version}
              </span>
              {behind > 0 && (
                <Badge bg="secondary" className="ms-1">
                  {behind}
                </Badge>
              )}
            </Button>
          );
        })}
        {newestFetch && (
          <span className="text-body-secondary small">
            данные от {formatDate(newestFetch)}
          </span>
        )}
        {hasError && (
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip>
                Не удалось обновить данные о версиях или уязвимостях — показаны
                сохранённые.
              </Tooltip>
            }
          >
            <span className="text-warning">
              <RiErrorWarningLine aria-hidden />
            </span>
          </OverlayTrigger>
        )}
      </div>

      <Offcanvas
        show={!!open}
        onHide={() => setOpenKey(null)}
        placement="end"
        className="mikrotik-panel"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            RouterOS <span className="font-monospace">{open?.version}</span>{" "}
            <span className="text-body-secondary">
              · {openKey ? BRANCH_LABEL[openKey] : ""}
            </span>
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {open?.releasedAt && (
            <div className="text-body-secondary mb-2">
              Вышла {formatDate(open.releasedAt)}
            </div>
          )}
          {openStats && openStats.total > 0 && (
            <div className="mb-2">
              Устройств на этой ветке: {openStats.total}
              {openStats.behind > 0 ? (
                <> · отстают от последней версии: {openStats.behind}</>
              ) : (
                <> · все на последней версии</>
              )}
            </div>
          )}
          <a
            href="https://mikrotik.com/download/changelogs"
            target="_blank"
            rel="noreferrer"
          >
            Открыть на mikrotik.com <RiExternalLinkLine aria-hidden />
          </a>
          <hr />
          {open?.changelog ? (
            <pre className="small mb-0" style={{ whiteSpace: "pre-wrap" }}>
              {open.changelog}
            </pre>
          ) : (
            <div className="text-body-secondary">Чейнджлог недоступен.</div>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export default RouterOsReleasesStrip;
