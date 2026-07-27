import { useEffect, useState } from "react";

// Тик на границе каждой минуты. Часы клиента в карточке заявки обязаны идти:
// специалист держит карточку открытой, а «03:14» из момента загрузки быстро
// перестаёт быть правдой. Идиом тот же, что в components/Company/useWorkingStatus.
//
// `enabled: false` — когда время приходит снаружи (в списках один тикер на всю
// страницу вместо таймера на строку).
export default function useMinuteTick(enabled = true) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;

    let interval;
    const start = new Date();
    const delay = (60 - start.getSeconds()) * 1000 - start.getMilliseconds();
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60000);
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [enabled]);

  return now;
}
