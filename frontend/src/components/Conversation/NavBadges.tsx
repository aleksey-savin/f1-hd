import CountPill from "@/components/app/CountPill";
import useConversationsStore from "@/store/conversations";

/**
 * Счётчик «Ждут ответа» в навигации: пилюлей у пункта «Диалоги» (бар и
 * бургер) и значком у вкладки телефона (канва A1, B1). Ноль не рисуется.
 * Подписка узкая — новый счётчик перерисовывает значок, а не оболочку.
 */
const useAwaitingCount = () =>
  useConversationsStore((state) => state.counts?.awaiting ?? 0);

const shortCount = (count: number) => (count > 99 ? "99+" : String(count));

export const NavCount = () => {
  const count = useAwaitingCount();
  if (!count) return null;
  return <CountPill>{shortCount(count)}</CountPill>;
};

export const TabCount = () => {
  const count = useAwaitingCount();
  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-2.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-xs leading-4 font-bold text-primary-foreground tabular-nums ring-2 ring-card">
      {shortCount(count)}
    </span>
  );
};
