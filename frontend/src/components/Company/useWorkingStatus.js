import { useEffect, useState } from "react";

import { getWorkingStatus } from "../../util/get-working-status";

// Живой статус графика работы: пересчёт на границе каждой минуты. Расчёт
// «работает ли сейчас» живёт в одном месте — хук делят легаси-индикатор
// (WorkingStatusIndicator) и tw-строки списка/шторки (WorkStatusText).
//
// timezone — пояс клиента (филиала или компании); пустой означает зону
// организации, то есть прежнее поведение (см. util/get-working-status).
export default function useWorkingStatus(workSchedule, timezone) {
  const [status, setStatus] = useState(() =>
    getWorkingStatus(workSchedule, timezone),
  );

  useEffect(() => {
    setStatus(getWorkingStatus(workSchedule, timezone));
    if (!workSchedule) return;

    let interval;
    const now = new Date();
    const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    const timeout = setTimeout(() => {
      setStatus(getWorkingStatus(workSchedule, timezone));
      interval = setInterval(
        () => setStatus(getWorkingStatus(workSchedule, timezone)),
        60000,
      );
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [workSchedule, timezone]);

  return status;
}
