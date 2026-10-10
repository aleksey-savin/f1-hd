import { useEffect } from "react";

import FilterChip from "@/components/app/FilterChip";
import { cn } from "@/lib/utils";
import { useAuthedUser, useCan } from "@/store/authed-user";
import useNotificationsStore from "@/store/notifications";
import useInitialPrefsStore from "@/store/prefs";
import { shownFacetKey, unreadInFacet, visibleFacets } from "@/util/notification-facets";

/**
 * Ряд чипов-фасетов панели уведомлений: какой вид показать. У чипа — число
 * непрочитанных этого вида, у «Все» числа нет (оно в заголовке). На десктопе
 * ряд переносится на вторую строку, на телефоне (`scroll`) — одна строка с
 * горизонтальной прокруткой без полосы.
 */
type Props = { scroll?: boolean; className?: string };

const FacetChips = ({ scroll = false, className }: Props) => {
  const facet = useNotificationsStore((state) => state.facet);
  const setFacet = useNotificationsStore((state) => state.setFacet);
  const unreadByCategory = useNotificationsStore(
    (state) => state.unreadByCategory,
  );
  const can = useCan();
  const messagingOn = useInitialPrefsStore(
    (state) => !!state.modules?.messaging?.isActive,
  );
  const mikrotikOn = useInitialPrefsStore(
    (state) => !!state.modules?.mikrotik?.isActive,
  );
  const isEndUser = useAuthedUser().isEndUser;
  const facets = visibleFacets({
    messaging: messagingOn && can({ conversation: ["read"] }),
    mikrotik: mikrotikOn && !isEndUser,
  });

  // Выключили модуль, а фасет остался в localStorage: чипа для сброса нет
  const stale = shownFacetKey(facet, facets) !== facet;
  useEffect(() => {
    if (stale) setFacet("all");
  }, [stale, setFacet]);

  return (
    <div
      role="group"
      aria-label="Вид уведомлений"
      className={cn(
        "flex gap-1.5",
        scroll
          ? "overflow-x-auto scrollbar-none"
          : "flex-wrap",
        className,
      )}
    >
      {facets.map((item) => (
        <FilterChip
          key={item.key}
          size="sm"
          active={item.key === facet}
          onClick={() => setFacet(item.key)}
          count={item.key === "all" ? null : unreadInFacet(unreadByCategory, item.key)}
          className="flex-none"
        >
          {item.label}
        </FilterChip>
      ))}
    </div>
  );
};

export default FacetChips;
