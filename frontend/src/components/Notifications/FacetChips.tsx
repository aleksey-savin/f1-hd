import FilterChip from "@/components/app/FilterChip";
import { cn } from "@/lib/utils";
import useNotificationsStore from "@/store/notifications";
import {
  NOTIFICATION_FACETS,
  unreadInFacet,
} from "@/util/notification-facets";

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
      {NOTIFICATION_FACETS.map((item) => (
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
