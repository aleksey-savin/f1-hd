import { useEffect, useState } from "react";

// Часы обратного отсчёта ожидания («1:24 из 10:00»). Только отображение:
// данные приходят пульсом (docs/live-updates.md), а за время ожидания бэкенд
// ничего не пишет — без своих часов отсчёт стоял бы. Живут, пока active.
export default function useUpgradeClock(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
