import { useEffect, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { useCan } from "@/store/authed-user";
import { RiRadarLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import Combobox from "@/components/app/Combobox";
import AlertMessage from "@/components/app/AlertMessage";
import { scopeOf, split } from "./discovery-scope";
export default function Discovery(props) {
  const can = useCan(),
    [open, setOpen] = useState(false);
  if (!can({ proxmox: ["discover"] })) return null;
  return (
    <div className="my-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <RiRadarLine />
        {open ? "Скрыть поиск" : "Найти в сети"}
      </Button>
      {open && (
        <Search
          {...props}
          onUse={(candidate) => {
            props.onUse(candidate);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
function Search({ mode, router, port, onUse }) {
  const startFetcher = useFetcher(),
    poll = useFetcher(),
    stop = useFetcher(),
    cleanup = useFetcher(),
    networks = useFetcher(),
    { pathname } = useLocation();
  const [ranges, setRanges] = useState(""),
    [network, setNetwork] = useState(null),
    [session, setSession] = useState(null),
    [attempted, setAttempted] = useState(false),
    [requestId, setRequestId] = useState(null);
  const current = useRef(null),
    cleanupSubmit = useRef(cleanup.submit);
  cleanupSubmit.current = cleanup.submit;
  const submit = (fetcher, data) =>
    fetcher.submit(data, {
      method: "post",
      action: pathname,
      encType: "application/json",
    });
  const release = () => {
    if (current.current)
      cleanupSubmit.current(
        { intent: "closeDiscovery", sessionId: current.current },
        { method: "post", action: pathname, encType: "application/json" },
      );
    current.current = null;
    setSession(null);
    setRequestId(null);
  };
  useEffect(
    () => () => {
      if (current.current)
        cleanupSubmit.current(
          { intent: "closeDiscovery", sessionId: current.current },
          { method: "post", action: pathname, encType: "application/json" },
        );
    },
    [pathname],
  );
  useEffect(() => {
    if (mode === "mikrotik" && router)
      networks.submit(
        { intent: "networks", mikrotikRecordId: router },
        { method: "post", encType: "application/json" },
      );
  }, [mode, router]);
  useEffect(() => {
    const result = startFetcher.data?.session;
    if (result?.id === current.current) setSession(result);
  }, [startFetcher.data]);
  useEffect(() => {
    const result = poll.data?.session;
    if (result?.id === current.current)
      setSession((previous) =>
        previous && !["queued", "running"].includes(previous.state)
          ? previous
          : result,
      );
  }, [poll.data]);
  useEffect(() => {
    const result = stop.data?.session;
    if (result?.id === current.current) setSession(result);
  }, [stop.data]);
  const running =
    session &&
    ["queued", "running"].includes(session.state) &&
    !(poll.data?.error && poll.data.sessionId === requestId);
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      if (poll.state === "idle")
        poll.load(
          `${pathname}?discoverySession=${encodeURIComponent(session.id)}`,
        );
    }, 2000);
    return () => clearTimeout(timer);
  }, [running, session, poll, pathname]);
  const scope = scopeOf(ranges, String(port));
  const begin = () => {
    setAttempted(true);
    if (
      !scope.count ||
      scope.error ||
      scope.portError ||
      (mode === "mikrotik" && !router)
    )
      return;
    release();
    const id = crypto.randomUUID();
    current.current = id;
    setRequestId(id);
    submit(startFetcher, {
      intent: "discover",
      clientSessionId: id,
      ranges: split(ranges),
      ports: scope.ports,
      transport: mode === "mikrotik" ? "mikrotik" : "direct",
      ...(mode === "mikrotik" ? { mikrotikRecordId: router } : {}),
    });
  };
  const change = (value) => {
    release();
    setRanges(value);
    setAttempted(false);
  };
  const failure = [startFetcher.data, poll.data, stop.data].find(
    (data) => data?.error && data.sessionId === requestId,
  );
  const error = requestId && (failure?.message || session?.error);
  return (
    <section
      aria-label="Поиск Proxmox в сети"
      className="mt-4 space-y-4 border-t border-border-soft pt-4"
    >
      <div>
        <h3 className="text-base font-semibold">Найти Proxmox в сети</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "mikrotik"
            ? "Поиск через выбранное устройство MikroTik."
            : "Поиск из сети сервера приложения."}{" "}
          Выберите найденный адрес, чтобы продолжить подключение.
        </p>
      </div>
      {mode === "mikrotik" && (
        <Field
          label="Доступная сеть"
          hint={
            !router ? "Сначала выберите устройство MikroTik выше." : undefined
          }
        >
          <Combobox
            ariaLabel="Доступная сеть"
            value={network}
            options={(networks.data?.items || []).map((n) => ({
              value: n.cidr,
              label: `${n.cidr}${n.interface ? ` · ${n.interface}` : ""}`,
            }))}
            onChange={(v) => {
              setNetwork(v);
              change(v || "");
            }}
          />
          {networks.data?.error && (
            <AlertMessage variant="danger" message={networks.data.message} />
          )}
        </Field>
      )}
      <Field
        label="Диапазон адресов"
        htmlFor="proxmox-discovery-range"
        hint="Подсеть, IPv4-адрес или диапазон. Например, 10.0.50.1-10.0.50.254."
        error={
          attempted
            ? scope.error || (!scope.count ? "Укажите диапазон адресов" : null)
            : null
        }
      >
        <Input
          id="proxmox-discovery-range"
          value={ranges}
          onChange={(e) => {
            setNetwork(null);
            change(e.target.value);
          }}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        Порт {port || "не указан"} ·{" "}
        {scope.count
          ? `${scope.count} адресов`
          : "используется порт из поля выше"}
      </p>
      {attempted && scope.portError && (
        <AlertMessage
          variant="danger"
          message="Укажите корректный порт сервера выше."
        />
      )}
      {running ? (
        <>
          <div
            role="progressbar"
            aria-label="Проверено адресов"
            aria-valuemin={0}
            aria-valuemax={session.total}
            aria-valuenow={session.cursor}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary"
              style={{
                width: `${session.total ? (session.cursor / session.total) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Проверено {session.cursor} из {session.total} адресов
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={stop.state !== "idle"}
              onClick={() =>
                submit(stop, {
                  intent: "cancelDiscovery",
                  sessionId: session.id,
                })
              }
            >
              {stop.state !== "idle" ? "Останавливаем…" : "Остановить"}
            </Button>
          </div>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={startFetcher.state !== "idle"}
          onClick={begin}
        >
          {startFetcher.state !== "idle"
            ? "Запуск поиска…"
            : session
              ? "Повторить поиск"
              : "Найти"}
        </Button>
      )}
      {error && <AlertMessage variant="danger" message={error} />}
      <div aria-live="polite">
        {session?.resultsLimited && (
          <p className="text-sm text-muted-foreground">
            Показаны первые 1024 адреса. Сузьте диапазон поиска.
          </p>
        )}
        {session?.state === "cancelled" && (
          <p className="text-sm text-muted-foreground">
            Поиск остановлен. Можно изменить диапазон и запустить его снова.
          </p>
        )}
        {session?.state === "completed" && !session.candidates?.length && (
          <p className="text-sm text-muted-foreground">
            Proxmox не найден. Проверьте диапазон и порт или укажите адрес
            вручную.
          </p>
        )}
        {Boolean(session?.candidates?.length) && (
          <>
            <p className="text-sm font-medium">
              Найдено адресов: {session.candidates.length}
            </p>
            <div className="divide-y divide-border-soft">
              {session.candidates.map((c) => (
                <div
                  key={`${c.host}:${c.port}`}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="break-all text-sm font-medium">
                      {c.host}:{c.port}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Возможный Proxmox · требуется проверка API
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onUse(c)}
                  >
                    Использовать
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
