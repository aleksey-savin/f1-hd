import { useEffect, useState } from "react";

import { getWorkingStatus } from "../../util/get-working-status";

// Живой статус графика работы: пересчёт на границе каждой минуты. Расчёт
// «работает ли сейчас» живёт в одном месте — хук делят легаси-индикатор
// (WorkingStatusIndicator) и tw-строки списка/шторки (WorkStatusText).
export default function useWorkingStatus(workSchedule) {
  const [status, setStatus] = useState(() => getWorkingStatus(workSchedule));

  useEffect(() => {
    setStatus(getWorkingStatus(workSchedule));
    if (!workSchedule) return;

    let interval;
    const now = new Date();
    const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    const timeout = setTimeout(() => {
      setStatus(getWorkingStatus(workSchedule));
      interval = setInterval(
        () => setStatus(getWorkingStatus(workSchedule)),
        60000,
      );
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [workSchedule]);

  return status;
}
