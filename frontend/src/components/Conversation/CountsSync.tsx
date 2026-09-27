import { useEffect } from "react";

import useLiveTopic from "@/hooks/use-live-topic";
import { useCan } from "@/store/authed-user";
import useConversationsStore from "@/store/conversations";
import useInitialPrefsStore from "@/store/prefs";

/**
 * Единственный загрузчик счётчиков «Диалогов» для навигации: при входе и
 * когда пульс говорит, что тема «conversations» сдвинулась. Монтируется один
 * раз в layout/Root для сотрудника; без модуля или права не делает ничего.
 */
const CountsSync = () => {
  const can = useCan();
  const moduleOn = useInitialPrefsStore(
    (state) => !!state.modules?.messaging?.isActive,
  );
  const enabled = moduleOn && can({ conversation: ["read"] });
  const refreshCounts = useConversationsStore((state) => state.refreshCounts);

  useEffect(() => {
    if (enabled) void refreshCounts();
  }, [enabled, refreshCounts]);

  useLiveTopic("conversations", refreshCounts, {
    enabled,
    // Счётчик в меню — не лента: реже, чем раз в 15 с, его трогать незачем
    minIntervalMs: 15_000,
  });

  return null;
};

export default CountsSync;
