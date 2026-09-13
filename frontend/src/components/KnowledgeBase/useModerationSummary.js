import { useEffect } from "react";

import useLiveTopic from "@/hooks/use-live-topic";
import useInitialPrefsStore from "../../store/prefs";
import useKnowledgeModerationStore from "../../store/knowledgeModeration";

// Подписка на счётчики очередей модерации: сеет их снимком из настроек,
// обновляет свежим запросом при монтировании и по пульсу, когда заметки
// изменились (docs/live-updates.md). Запрос делают только модераторы —
// остальным сводка возвращает нули.
const useModerationSummary = () => {
  const kb = useInitialPrefsStore((state) => state.knowledgeBase);
  const counts = useKnowledgeModerationStore((state) => state.counts);
  const seed = useKnowledgeModerationStore((state) => state.seed);
  const refresh = useKnowledgeModerationStore((state) => state.refresh);

  useEffect(() => {
    if (!kb.isModerator) {
      return;
    }
    seed(kb.counts);
    refresh();
  }, [kb.isModerator, kb.counts, seed, refresh]);

  useLiveTopic("knowledge", refresh, { enabled: !!kb.isModerator });

  return {
    counts,
    refresh,
    isModerator: kb.isModerator,
    scanForSecrets: kb.scanForSecrets,
  };
};

export default useModerationSummary;
