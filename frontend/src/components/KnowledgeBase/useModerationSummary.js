import { useEffect } from "react";

import useInitialPrefsStore from "../../store/prefs";
import useKnowledgeModerationStore from "../../store/knowledgeModeration";

// Подписка на счётчики очередей модерации: сеет их снимком из настроек и
// обновляет свежим запросом при монтировании. Запрос делают только модераторы —
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

  return {
    counts,
    refresh,
    isModerator: kb.isModerator,
    scanForSecrets: kb.scanForSecrets,
  };
};

export default useModerationSummary;
