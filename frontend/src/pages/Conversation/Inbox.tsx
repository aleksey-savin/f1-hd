import { setDocTitle } from "@/hooks/use-doc-title";
import { useEffect, useState, type ChangeEvent } from "react";
import { Link, useMatch, useOutlet } from "react-router";
import { isMobile } from "react-device-detect";
import { RiAddLine } from "react-icons/ri";

import FormOutlet from "@/components/app/FormOutlet";
import PageHeader from "@/components/app/PageHeader";
import SearchBar from "@/components/app/SearchBar";
import ConversationList from "@/components/Conversation/ConversationList";
import ListFilter from "@/components/Conversation/ListFilter";
import QueueSelector from "@/components/Conversation/QueueSelector";
import useLiveTopic from "@/hooks/use-live-topic";
import useConversationsStore from "@/store/conversations";
import { Button } from "@/components/ui/button";
import { useAuthedUser, useCan } from "@/store/authed-user";
import { inboxOutletState } from "@/util/new-conversation";

/**
 * «Диалоги» — рабочее место переписки с клиентами (канва A1/A2 — десктоп,
 * B1/B4 — телефон).
 *
 * Десктоп: шапка (заголовок со счётчиком, режимы, поиск, фильтры) и одна
 * панель на три колонки — список 256 · переписка · контакт 352. Переписка и
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

const NewDialogueButton = ({ phone = false }: { phone?: boolean }) => {
  const { isEndUser } = useAuthedUser();
  const canReply = useCan()({ conversation: ["reply", "start"] });
  if (isEndUser || !canReply) return null;
  return (
    <Button asChild size={phone ? "icon" : "default"}>
      <Link to="/conversations/new" aria-label="Новый диалог">
        <RiAddLine />
        {!phone && "Новый диалог"}
      </Link>
    </Button>
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
        title={<Title />}
        search={
          <SearchBar
            placeholder="Поиск по диалогам"
            value={search.value}
            onChange={search.onChange}
          />
        }
        controls={
          <>
            <QueueSelector />
            <ListFilter />
          </>
        }
        action={<NewDialogueButton />}
      />
      <div className="mt-4 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
        <nav
          aria-label="Список диалогов"
          className="w-64 flex-none overflow-y-auto border-r border-border-soft"
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
          <NewDialogueButton phone />
          <ListFilter phone />
        </div>
        <SearchBar
          placeholder="Поиск по диалогам"
          value={search.value}
          onChange={search.onChange}
        />
        <QueueSelector compact />
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
        <ConversationList phone />
      </div>
    </div>
  );
};

const Inbox = () => {
  const outlet = useOutlet();
  const newMatch = useMatch("/conversations/new");
  const match = useMatch("/conversations/:id/*");
  const { selectedId, ownsSheet } = inboxOutletState(match?.params.id);

  useEffect(() => {
    void useConversationsStore.getState().load();
  }, []);

  // Заголовок вкладки ставит загрузчик диалога; вернулись к списку — свой
  useEffect(() => {
    if (!selectedId) setDocTitle(newMatch ? "Новый диалог" : "Диалоги");
  }, [selectedId, newMatch]);

  useLiveTopic(
    "conversations",
    () => useConversationsStore.getState().silentRefresh(),
    // Шумная тема: каждое сообщение каждого диалога — не чаще раза в 5 с
    { minIntervalMs: 5_000 },
  );

  if (isMobile)
    return (
      <>
        {ownsSheet ? (
          <>
            <PhoneInbox />
            <FormOutlet />
          </>
        ) : (
          outlet
        )}
      </>
    );
  // Thread owns its nested sheets; only the new-dialogue sheet belongs to Inbox.
  return (
    <>
      <DesktopInbox outlet={newMatch ? null : outlet} selectedId={selectedId} />
      {ownsSheet ? <FormOutlet /> : null}
    </>
  );
};

export default Inbox;

export function loader() {
  setDocTitle("Диалоги");
  return null;
}
