import { useEffect, useState, type ChangeEvent } from "react";
import { useMatch, useOutlet } from "react-router";
import { isMobile } from "react-device-detect";

import PageHeader from "@/components/app/PageHeader";
import SearchBar from "@/components/app/SearchBar";
import ConversationList from "@/components/Conversation/ConversationList";
import ListFilter from "@/components/Conversation/ListFilter";
import QueueChips from "@/components/Conversation/QueueChips";
import useLiveTopic from "@/hooks/use-live-topic";
import useConversationsStore from "@/store/conversations";

/**
 * «Диалоги» — рабочее место переписки с клиентами (канва A1/A2 — десктоп,
 * B1/B4 — телефон).
 *
 * Десктоп: шапка (заголовок со счётчиком, чипы очередей, поиск, фильтры) и одна
 * панель на три колонки — список 352 · переписка · контакт 320. Переписка и
 * контакт — вложенный маршрут `:id` (pages/Conversation/Thread), список живёт
 * здесь и не перерисовывается при переходе между диалогами.
 *
 * Телефон: без выбранного диалога — список; с выбранным — только переписка на
 * весь экран (маршрут диалога просит оболочку об этом `handle.phoneFullscreen`).
 *
 * Список обновляется по теме пульса «conversations» (docs/live-updates.md).
 */

const SEARCH_DEBOUNCE_MS = 300;

/** Поиск с задержкой: запрос уходит, когда человек перестал печатать. */
const useSearchInput = () => {
  const q = useConversationsStore((state) => state.q);
  const setSearch = useConversationsStore((state) => state.setSearch);
  const [value, setValue] = useState(q);

  useEffect(() => {
    if (value === q) return undefined;
    const timer = setTimeout(() => setSearch(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, q, setSearch]);

  return {
    value,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setValue(event.target.value),
  };
};

const Title = ({ phone = false }: { phone?: boolean }) => {
  const total = useConversationsStore((state) => state.counts?.all ?? null);
  return (
    <h1
      className={
        phone
          ? "my-0 flex items-baseline gap-2 text-3xl leading-9 font-semibold tracking-tight"
          : "my-0 flex items-baseline gap-2.5 text-3xl leading-none font-semibold tracking-tight whitespace-nowrap"
      }
    >
      Диалоги
      {total !== null && (
        <span className="text-xl font-medium tracking-normal text-faint tabular-nums">
          {total}
        </span>
      )}
    </h1>
  );
};

const DesktopInbox = ({
  outlet,
  selectedId,
}: {
  outlet: ReturnType<typeof useOutlet>;
  selectedId: string | null;
}) => {
  const search = useSearchInput();
  return (
    // Высота — весь лист страницы: 100svh минус отступ под бар (5rem), поле
    // снизу (1.5rem) и внутренние поля листа (2 × 1rem) — layout/Root
    <div className="flex h-[calc(100svh-8.5rem)] min-h-[34rem] flex-col">
      <PageHeader
        title={
          <div className="flex items-center gap-x-3">
            <Title />
            <QueueChips className="ms-4" />
          </div>
        }
        search={
          <SearchBar
            placeholder="Поиск по диалогам"
            value={search.value}
            onChange={search.onChange}
          />
        }
        controls={<ListFilter />}
      />
      <div className="mt-4 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
        <nav
          aria-label="Список диалогов"
          className="w-88 flex-none overflow-y-auto border-r border-border-soft"
        >
          <ConversationList selectedId={selectedId} />
        </nav>
        {outlet ?? (
          <section
            aria-label="Переписка"
            className="grid min-w-0 flex-1 place-items-center p-6 text-center text-sm text-muted-foreground"
          >
            Выберите диалог в списке слева
          </section>
        )}
      </div>
    </div>
  );
};

const PhoneInbox = () => {
  const search = useSearchInput();
  return (
    <div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <Title phone />
          <span className="flex-1" />
          <ListFilter phone />
        </div>
        <SearchBar
          placeholder="Поиск по диалогам"
          value={search.value}
          onChange={search.onChange}
        />
        <QueueChips size="sm" className="scrollbar-none overflow-x-auto" />
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
        <ConversationList phone />
      </div>
    </div>
  );
};

const Inbox = () => {
  const outlet = useOutlet();
  const match = useMatch("/conversations/:id/*");
  const selectedId = match?.params.id ?? null;

  useEffect(() => {
    void useConversationsStore.getState().load();
  }, []);

  // Заголовок вкладки ставит загрузчик диалога; вернулись к списку — свой
  useEffect(() => {
    if (!selectedId) document.title = "Диалоги";
  }, [selectedId]);

  useLiveTopic(
    "conversations",
    () => useConversationsStore.getState().silentRefresh(),
    // Шумная тема: каждое сообщение каждого диалога — не чаще раза в 5 с
    { minIntervalMs: 5_000 },
  );

  if (isMobile) return outlet ?? <PhoneInbox />;
  return <DesktopInbox outlet={outlet} selectedId={selectedId} />;
};

export default Inbox;

export function loader() {
  document.title = "Диалоги";
  return null;
}
