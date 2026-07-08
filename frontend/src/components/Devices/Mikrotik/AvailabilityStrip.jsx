import { useEffect, useState } from "react";

import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

import {
  buildStripSegments,
  UptimeStrip,
  uptimeToneClass,
} from "./AvailabilityReport";

// Компактная сводка доступности для превью-панели: процент за 30 дней + мини-
// лента. Молчаливо не рендерится, пока данных нет (панель — быстрый просмотр).
const AvailabilityStrip = ({ recordId }) => {
  const fetchAvailability = useMikrotikDeviceFilterStore(
    (state) => state.fetchAvailability,
  );
  const [report, setReport] = useState(null);

  useEffect(() => {
    if (!recordId) return undefined;
    let ignore = false;
    setReport(null);
    (async () => {
      const data = await fetchAvailability(recordId, 30);
      if (!ignore && data) setReport(data);
    })();
    return () => {
      ignore = true;
    };
  }, [recordId, fetchAvailability]);

  if (!report || report.uptimePct == null) return null;

  return (
    <div className="mt-3">
      <div className="d-flex justify-content-between align-items-baseline small mb-1">
        <span className="text-body-secondary">Доступность 30 дн</span>
        <span className={`fw-semibold ${uptimeToneClass(report.uptimePct)}`}>
          {report.uptimePct} %
        </span>
      </div>
      <UptimeStrip segments={buildStripSegments(report)} height={8} />
    </div>
  );
};

export default AvailabilityStrip;
