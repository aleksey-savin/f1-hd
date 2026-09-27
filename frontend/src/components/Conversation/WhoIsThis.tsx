import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  RiAddLine,
  RiEyeOffLine,
  RiSearchLine,
  RiUserLine,
} from "react-icons/ri";

import { SubLabel } from "@/components/app/Panel";
import { monogramFor } from "@/components/app/monogram";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCan } from "@/store/authed-user";
import type { ConversationCard, IdentityCandidate } from "@/types/conversation";
import {
  counterpartHandle,
  linkAdvice,
  networkLabel,
} from "@/util/conversation-format";

import { linkIdentity, setHidden } from "./conversation-actions";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

/**
 * «Кто это?» — собеседник не связан ни с одним пользователем (канва C2).
 * Связать можно только руками: поиск пользователя → «Это он». Имя из
 * мессенджера ничего не доказывает, поэтому сами мы не связываем (спека
 * «Identity»). «Новый пользователь» — обычная форма пользователя поверх
 * диалога, после сохранения собеседник связывается с новым человеком.
 * «Скрыть диалог» — для спама и ошибшихся номером.
 */
const WhoIsThis = ({
  card,
  canManage,
  onLinked,
}: {
  card: ConversationCard;
  canManage: boolean;
  onLinked: () => void;
}) => {
  const { conversation, counterpart } = card;
  const navigate = useNavigate();
  const canManageUsers = useCan()({ user: ["manage"] });
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<IdentityCandidate[] | null>(null);
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!counterpart || q.length < MIN_QUERY) {
      setFound(null);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api<{ items: IdentityCandidate[] }>(
        `/api/identities/${counterpart.identityId}/candidates?${new URLSearchParams({ q })}`,
      )
        .then((data) => {
          if (alive) setFound(data.items);
        })
        .catch(() => {
          if (alive) setFound([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, counterpart]);

  const link = async (person: IdentityCandidate) => {
    if (!counterpart) return;
    setLinking(person.id);
    const ok = await linkIdentity(counterpart.identityId, person.id, person.name);
    setLinking(null);
    if (ok) onLinked();
  };

  const hide = async () => {
    if (await setHidden(conversation.id, true)) navigate("/conversations");
  };

  const handle = counterpartHandle(counterpart);

  return (
    <>
      <SubLabel>Кто это?</SubLabel>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-11 flex-none place-items-center rounded-[25%] bg-accent text-muted-foreground inset-ring inset-ring-border"
        >
          <RiUserLine size={22} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-base leading-6 font-semibold">
            {conversation.title || counterpart?.name || "Собеседник"}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {[networkLabel(conversation.network), handle].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
      <p className="mt-3 mb-0 text-sm text-muted-foreground">
        {linkAdvice(conversation.network)}
      </p>

      {canManage && counterpart && (
        <>
          <label
            htmlFor="who-is-this-search"
            className="mt-3.5 mb-1.5 block text-sm font-semibold text-muted-foreground"
          >
            Найти пользователя
          </label>
          <div className="relative">
            <RiSearchLine
              size={16}
              aria-hidden
              className="absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <Input
              id="who-is-this-search"
              type="search"
              value={query}
              placeholder="Имя, телефон или почта"
              onChange={(event) => setQuery(event.target.value)}
              className="bg-card pl-9"
            />
          </div>
          <div className="mt-1.5">
            {found?.map((person, index) => (
              <div
                key={person.id}
                className={cn(
                  "flex items-center gap-2.5 py-2",
                  index > 0 && "border-t border-border-soft",
                )}
              >
                <span
                  aria-hidden
                  className="grid size-7 flex-none place-items-center rounded-[25%] bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border"
                >
                  {monogramFor(person.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{person.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[person.company, person.position].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={linking !== null}
                  onClick={() => void link(person)}
                >
                  Это он
                </Button>
              </div>
            ))}
            {found?.length === 0 && (
              <p className="my-2 text-xs text-faint">Никого не нашли</p>
            )}
          </div>
        </>
      )}

      {(canManage || canManageUsers) && (
        <div className="mt-3.5 flex flex-col gap-2 border-t border-border-soft pt-3.5">
          {canManage && canManageUsers && counterpart && (
            <Button variant="outline" size="sm" className="w-full" onClick={() => navigate("users/add")}>
              <RiAddLine />
              Новый пользователь
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => void hide()}>
              <RiEyeOffLine />
              Скрыть диалог
            </Button>
          )}
        </div>
      )}
    </>
  );
};

export default WhoIsThis;
