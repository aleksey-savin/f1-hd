import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  RiAttachment2,
  RiSearchLine,
  RiSendPlane2Line,
  RiUserLine,
  RiCloseLine,
} from "react-icons/ri";

import Forbidden from "@/components/Error/403";
import AlertMessage from "@/components/app/AlertMessage";
import Field from "@/components/app/Field";
import { FormActions, FormHeader } from "@/components/app/FormLayout";
import { useFormSheet } from "@/components/app/FormOutlet";
import Segmented from "@/components/app/Segmented";
import { monogramFor } from "@/components/app/monogram";
import { ChannelIcon } from "@/components/Conversation/ChannelGlyph";
import { failureText } from "@/components/Conversation/conversation-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { setDocTitle } from "@/hooks/use-doc-title";
import { ApiError, api } from "@/lib/api";
import { useAuthedUser } from "@/store/authed-user";
import type {
  ConversationRecipient,
  OutgoingStart,
  PendingStart,
  StartRecipient,
  StartRoutes,
} from "@/types/conversation";
import {
  assertBrowserSessionCurrent,
  browserSessionGeneration,
} from "@/util/browser-session.js";
import { networkLabel } from "@/util/conversation-format";
import {
  pendingStartSnapshot,
  phoneRecipient,
  readPendingStart,
  startAction,
  startRoutes,
  startRoutesBlockReason,
  pendingAfterStartFailure,
  pendingAfterAbandon,
} from "@/util/new-conversation";
import { formatPhone } from "@/util/phone";

const storageKey = (userId: string) => `conversation-start:${userId}`;

function restore(userId: string): PendingStart | null {
  try {
    return readPendingStart(sessionStorage.getItem(storageKey(userId)));
  } catch {
    return null;
  }
}

/** Async receipt lives beyond the sheet; only identifiers and the recipient are stored. */
function save(userId: string, pending: PendingStart | null) {
  if (pending)
    sessionStorage.setItem(storageKey(userId), pendingStartSnapshot(pending));
  else {
    try {
      sessionStorage.removeItem(storageKey(userId));
    } catch {
      // Closing a resolved request must still work when browser storage becomes unavailable.
    }
  }
}

const NewConversationForm = () => {
  const user = useAuthedUser();
  const { close, closing } = useFormSheet();
  const [initial] = useState(() => restore(user._id));
  const pending = useRef<PendingStart | null>(initial);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const [recipient, setRecipient] = useState<StartRecipient | null>(
    initial?.recipient ?? null,
  );
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<ConversationRecipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [routes, setRoutes] = useState<StartRoutes["routes"]>([]);
  const [routeId, setRouteId] = useState("");
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [routeReload, setRouteReload] = useState(0);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [accepted, setAccepted] = useState<OutgoingStart | null>(null);
  const [checking, setChecking] = useState(!!initial);
  const [recoveryRequired, setRecoveryRequired] = useState(!!initial);
  const [retryUncertain, setRetryUncertain] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");
  const [checkAgain, setCheckAgain] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedRoute = routes.find((route) => route.id === routeId) ?? null;
  const rawRecipient = phoneRecipient(query);
  const blockedReason = startRoutesBlockReason(routes);
  const recipientBlocked = !loadingRoutes && !routeError && blockedReason !== null && !accepted && !recoveryRequired;
  const locked = sending || checking || recoveryRequired || accepted !== null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (recipient || query.trim().length < 2) {
      setPeople([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    const controller = new AbortController();
    setPeople([]);
    setSearching(true);
    setSearchError("");
    const timer = setTimeout(() => {
      void api<{ items: ConversationRecipient[] }>(
        `/api/conversations/recipients?${new URLSearchParams({ q: query.trim() })}`,
        { signal: controller.signal },
      )
        .then((data) => {
          if (!controller.signal.aborted) setPeople(data.items);
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted)
            setSearchError(failureText(err, "Не удалось найти получателя"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, recipient]);

  useEffect(() => {
    setRoutes([]);
    setRouteId("");
    setRouteError("");
    if (!recipient || accepted || recoveryRequired) return;
    const controller = new AbortController();
    const params: Record<string, string> = recipient.userId
      ? { userId: recipient.userId }
      : { phone: recipient.phone };
    setLoadingRoutes(true);
    void api<StartRoutes>(
      `/api/conversations/start-routes?${new URLSearchParams(params)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        const choices = startRoutes(data.routes);
        setRoutes(choices);
        setRouteId(choices.find((route) => route.available)?.id ?? "");
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setRouteError(failureText(err, "Не удалось загрузить мессенджеры"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRoutes(false);
      });
    return () => controller.abort();
  }, [recipient, accepted, recoveryRequired, routeReload]);

  // Reopening or reloading first resolves the existing request, including a lost POST response.
  useEffect(() => {
    const request = pending.current;
    if (!request || !recoveryRequired || accepted) return;
    const controller = new AbortController();
    setChecking(true);
    const path = request.messageId
      ? `/api/conversations/outgoing/${request.messageId}`
      : `/api/conversations/outgoing/request/${request.clientRequestId}`;
    void api<OutgoingStart>(path, { signal: controller.signal })
      .then((receipt) => {
        if (controller.signal.aborted) return;
        const next = { ...request, messageId: receipt.messageId };
        save(user._id, next);
        pending.current = next;
        setAccepted(receipt);
        setRecoveryRequired(false);
        setError("");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (
          !request.messageId &&
          err instanceof ApiError &&
          err.status === 404
        ) {
          setRecoveryRequired(false);
          setError(
            (current) =>
              current || "Сообщение ещё не принято. Можно повторить отправку.",
          );
        } else
          setError(
            failureText(
              err,
              "Не удалось проверить отправку. Проверьте состояние ещё раз.",
            ),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [recoveryRequired, checkAgain, accepted, user._id]);

  useEffect(() => {
    if (!accepted) return;
    if (accepted.status === "failed" && !retryUncertain) {
      setError(accepted.error || "Не удалось доставить сообщение");
      return;
    }
    if (accepted.conversationId && !retryUncertain) {
      save(user._id, null);
      close(`/conversations/${accepted.conversationId}`, { replace: true });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<OutgoingStart>(
        `/api/conversations/outgoing/${accepted.messageId}`,
        { signal: controller.signal },
      )
        .then((receipt) => {
          if (!controller.signal.aborted) {
            setAccepted(receipt);
            setRetryUncertain(false);
            setError("");
          }
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              failureText(
                err,
                "Не удалось проверить отправку. Проверка продолжится автоматически.",
              ),
            );
            setCheckAgain((value) => value + 1);
          }
        });
    }, 2000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [accepted, retryUncertain, checkAgain, close, user._id]);

  const selectRecipient = (next: StartRecipient) => {
    setRecipient(next);
    setValidation("");
    setError("");
  };

  const startAnother = async () => {
    if (
      !accepted ||
      accepted.status !== "failed" ||
      sending ||
      checking ||
      retryUncertain ||
      inFlight.current
    )
      return;
    const generation = browserSessionGeneration();
    setChecking(true);
    try {
      const receipt = await api<OutgoingStart>(
        `/api/conversations/outgoing/${accepted.messageId}`,
      );
      assertBrowserSessionCurrent(generation);
      if (!mounted.current) return;
      if (pendingAfterAbandon(pending.current, receipt)) {
        setAccepted(receipt);
        return;
      }
      save(user._id, null);
      pending.current = null;
      setAccepted(null);
      setRecipient(null);
      setQuery("");
      setText("");
      setFiles([]);
      setError("");
      setValidation("");
    } catch (err) {
      if (mounted.current)
        setError(failureText(err, "Не удалось проверить отправку"));
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || closing || checking) return;
    if (recoveryRequired) {
      setCheckAgain((value) => value + 1);
      return;
    }
    const action = startAction(accepted, selectedRoute);
    if (action === "open" && selectedRoute?.target === "conversation") {
      save(user._id, null);
      pending.current = null;
      close(`/conversations/${selectedRoute.conversationId}`, {
        replace: true,
      });
      return;
    }
    if (action === "poll") {
      setCheckAgain((value) => value + 1);
      return;
    }
    if (action === "blocked" || !recipient) {
      setValidation(
        !recipient ? "Выберите получателя" : blockedReason || "Выберите доступный мессенджер",
      );
      return;
    }
    if (action === "start" && !text.trim() && !files.length) {
      setValidation("Напишите сообщение или прикрепите файл");
      return;
    }
    const previousAttemptUnknown =
      pending.current !== null && accepted === null;
    const generation = browserSessionGeneration();
    inFlight.current = true;
    setSending(true);
    setError("");
    setValidation("");
    try {
      if (action === "retry" && accepted) {
        await api(`/api/messages/${accepted.messageId}/retry`, {
          method: "POST",
        });
        assertBrowserSessionCurrent(generation);
        if (mounted.current)
          setAccepted({ ...accepted, status: "queued", error: null });
      } else {
        const request = pending.current ?? {
          clientRequestId: crypto.randomUUID(),
          recipient,
        };
        // Saving before POST is required: a timeout can hide an accepted message.
        save(user._id, request);
        pending.current = request;
        const body = new FormData();
        body.append("clientRequestId", request.clientRequestId);
        if (recipient.userId) body.append("userId", recipient.userId);
        else body.append("phone", recipient.phone);
        body.append("routeId", selectedRoute!.id);
        body.append("text", text.trim());
        for (const file of files) body.append("attachments", file);
        const receipt = await api<OutgoingStart>("/api/conversations/start", {
          method: "POST",
          body,
        });
        assertBrowserSessionCurrent(generation);
        const next = { ...request, messageId: receipt.messageId };
        save(user._id, next);
        pending.current = next;
        if (mounted.current) setAccepted(receipt);
      }
    } catch (err) {
      // A definitive response can arrive after the user closed the sheet.
      // Resolve its persisted request too, so reopening does not restore a rejected send.
      const rejected =
        !accepted &&
        pending.current !== null &&
        pendingAfterStartFailure(
          pending.current,
          err instanceof ApiError ? err.status : undefined,
          previousAttemptUnknown,
        ) === null;
      if (rejected) {
        save(user._id, null);
        pending.current = null;
      }
      if (mounted.current) {
        setError(failureText(err, "Не удалось отправить сообщение"));
        if (accepted) setRetryUncertain(true);
        else if (rejected) setRouteReload((value) => value + 1);
        else if (pending.current) setRecoveryRequired(true);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  };

  return (
    <form aria-label="Новый диалог" onSubmit={(event) => void submit(event)}>
      <FormHeader
        title="Новый диалог"
        subtitle={undefined}
        onHeight={undefined}
        children={undefined}
      />
      <Field
        label="Получатель"
        className="pt-3"
        htmlFor={recipient ? undefined : "new-conversation-recipient"}
        required
        aside={
          recipient && !locked && !pending.current ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => {
                save(user._id, null);
                pending.current = null;
                setRecipient(null);
                setValidation("");
                setError("");
              }}
            >
              Изменить
            </Button>
          ) : null
        }
      >
        {recipient ? (
          <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-3">
            <span
              aria-hidden
              className="grid size-10 flex-none place-items-center rounded-lg bg-accent text-muted-foreground"
            >
              <RiUserLine size={20} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {recipient.name}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {recipient.userId
                  ? formatPhone(recipient.phone) || "Пользователь HD"
                  : "Номер телефона"}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="relative">
              <RiSearchLine
                size={17}
                aria-hidden
                className="absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              />
              <Input
                id="new-conversation-recipient"
                type="search"
                autoComplete="off"
                placeholder="Имя, телефон или почта"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <div
              className="mt-3 overflow-hidden rounded-lg border border-border-soft"
              aria-live="polite"
              aria-busy={searching}
            >
              {people.map((person) => (
                <button
                  type="button"
                  key={person.id}
                  onClick={() =>
                    selectRecipient({
                      userId: person.id,
                      name: person.name,
                      phone: person.phone,
                    })
                  }
                  className="flex w-full cursor-pointer items-center gap-3 appearance-none border-0 border-b border-border-soft bg-transparent px-3 py-3 text-left text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-ring"
                >
                  <span
                    aria-hidden
                    className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-sm font-semibold text-muted-foreground"
                  >
                    {monogramFor(person.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {person.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {[person.company, formatPhone(person.phone), person.email]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
              {rawRecipient && (
                <button
                  type="button"
                  onClick={() => selectRecipient(rawRecipient)}
                  className="flex w-full cursor-pointer items-center gap-3 appearance-none border-0 bg-transparent px-3 py-3 text-left text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-ring"
                >
                  <RiSendPlane2Line
                    size={20}
                    aria-hidden
                    className="text-muted-foreground"
                  />
                  <span>
                    <span className="block text-sm font-semibold">
                      Написать на {rawRecipient.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Без создания пользователя
                    </span>
                  </span>
                </button>
              )}
              {(searching ||
                searchError ||
                (!people.length && !rawRecipient)) && (
                <p className="m-0 p-3 text-sm text-muted-foreground">
                  {searching
                    ? "Поиск…"
                    : searchError ||
                      (query.trim().length < 2
                        ? "Введите имя, телефон или почту"
                        : "Никого не нашли. Можно ввести номер телефона.")}
                </p>
              )}
            </div>
          </>
        )}
      </Field>
      {recipient && !accepted && !recoveryRequired && (
        <Field label="Мессенджер" required>
          {loadingRoutes ? (
            <p role="status" className="text-sm text-muted-foreground">
              Загрузка мессенджеров…
            </p>
          ) : routeError ? (
            <>
              <AlertMessage variant="danger" message={routeError} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRouteReload((value) => value + 1)}
              >
                Повторить
              </Button>
            </>
          ) : routes.length ? (
            <>
              {blockedReason && (
                <AlertMessage variant="warning" message={blockedReason} />
              )}
              <Segmented
                disabled={locked || recipientBlocked}
                ariaLabel="Мессенджер"
                value={routeId}
                onChange={setRouteId}
                options={routes.map((route) => ({
                  value: route.id,
                  label: networkLabel(route.network),
                  icon: <ChannelIcon network={route.network} />,
                  disabled: !route.available,
                  title: route.reason || undefined,
                }))}
              />
              {routes
                .filter((route) => !blockedReason && !route.available)
                .map((route) => (
                  <p
                    key={route.id}
                    className="mt-1.5 mb-0 text-xs text-muted-foreground"
                  >
                    {networkLabel(route.network)}:{" "}
                    {route.reason || "недоступно"}
                  </p>
                ))}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Нет подключённых мессенджеров
            </p>
          )}
        </Field>
      )}
      {recipient && selectedRoute?.target === "conversation" && !accepted ? (
        <p className="my-4 text-sm text-muted-foreground">
          В {networkLabel(selectedRoute.network)} уже есть переписка с этим
          получателем.
        </p>
      ) : (
        recipient &&
        !recoveryRequired && (
          <Field
            label="Сообщение"
            htmlFor="new-conversation-message"
            required={!files.length}
          >
            <Textarea
              id="new-conversation-message"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              placeholder={
                accepted ? "Сообщение принято сервером" : "Напишите сообщение"
              }
              disabled={locked || recipientBlocked}
              className="resize-none"
              aria-invalid={!!validation && !text.trim() && !files.length}
            />
            <input
              ref={fileInput}
              id="new-conversation-files"
              type="file"
              multiple
              className="hidden"
              disabled={locked || recipientBlocked}
              onChange={(event) => {
                setFiles((current) => [
                  ...current,
                  ...(event.target.files ?? []),
                ]);
                event.target.value = "";
              }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={locked || recipientBlocked}
                onClick={() => fileInput.current?.click()}
              >
                <RiAttachment2 />
                Файл
              </Button>
              {files.map((file, index) => (
                <span
                  key={`${file.name}-${index}`}
                  className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
                >
                  <span className="max-w-56 truncate">{file.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Убрать ${file.name}`}
                    disabled={locked || recipientBlocked}
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <RiCloseLine />
                  </Button>
                </span>
              ))}
            </div>
          </Field>
        )
      )}
      {(checking ||
        retryUncertain ||
        (accepted && accepted.status !== "failed")) && (
        <p role="status" className="text-sm text-muted-foreground">
          {checking || retryUncertain
            ? "Проверяем предыдущее сообщение…"
            : "Сообщение принято. Ожидаем создания диалога… Можно закрыть форму и вернуться позже."}
        </p>
      )}
      {pending.current && !accepted && !recoveryRequired && (
        <p className="text-sm text-muted-foreground">
          Предыдущая отправка ещё не подтверждена. При повторе получатель
          сохранится. Если сообщение уже принято, откроется его диалог.
        </p>
      )}
      {validation && (
        <p role="alert" className="text-sm text-destructive">
          {validation}
        </p>
      )}
      {error && <AlertMessage variant="danger" message={error} />}
      {accepted?.status === "failed" && (
        <Button
          type="button"
          variant="link"
          className="px-0"
          disabled={sending || checking || retryUncertain}
          onClick={() => void startAnother()}
        >
          Начать другой диалог
        </Button>
      )}
      <FormActions className={undefined}>
        <Button type="button" variant="ghost" onClick={() => close()}>
          Отмена
        </Button>
        <Button
          className="ml-auto"
          type="submit"
          disabled={
            recipientBlocked ||
            sending ||
            checking ||
            retryUncertain ||
            closing ||
            (accepted !== null && accepted.status !== "failed")
          }
        >
          <RiSendPlane2Line />
          {sending
            ? "Отправка…"
            : recoveryRequired
              ? "Проверить отправку"
              : accepted?.status === "failed"
                ? "Повторить отправку"
                : selectedRoute?.target === "conversation"
                  ? "Открыть диалог"
                  : "Отправить"}
        </Button>
      </FormActions>
    </form>
  );
};

const NewConversation = () => {
  const { isEndUser } = useAuthedUser();
  return isEndUser ? <Forbidden /> : <NewConversationForm />;
};

export default NewConversation;

export function loader() {
  setDocTitle("Новый диалог");
  return null;
}
