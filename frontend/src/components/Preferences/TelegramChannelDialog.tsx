import { useEffect, useState, type ReactNode } from "react";
import {
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiQrCodeLine,
} from "react-icons/ri";

import ConfirmDialog from "@/components/app/ConfirmDialog";
import Field from "@/components/app/Field";
import PasswordInput from "@/components/app/PasswordInput";
import QrCode from "@/components/app/QrCode";
import { ChannelTile } from "@/components/Conversation/ChannelGlyph";
import { failureText } from "@/components/Conversation/conversation-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import useLiveTopic from "@/hooks/use-live-topic";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthedUser } from "@/store/authed-user";
import usePulseStore from "@/store/pulse";
import useToastStore from "@/store/toast-store";
import type { ChannelJobView, MessagingChannel } from "@/types/conversation";
import {
  historyEnabled,
  loginStage,
  loginStepPending,
  qrSecondsLeft,
  signatureExample,
  splitProxyPassword,
} from "@/util/channel-state";
import { plural } from "@/util/plural";

/**
 * «Telegram — вход» (канва E3 для WhatsApp, перенесённая на Telegram): слева
 * вход — QR-код, код из Telegram или SMS, пароль двухэтапной проверки; справа
 * шаги, ключи приложения Telegram и прокси с «Проверить»; ниже — настройки
 * канала свитчами. «Сохранить» пишет настройки и секреты канала; вход и
 * проверка сначала сохраняют введённое — шлюз читает канал из базы.
 *
 * Состояние входа пишет шлюз (`channel.state`), страница узнаёт о нём из
 * пульса (тема «channels»); пока вход или проверка идут, пульс чаще — 2 с.
 */

const DEFAULT_HISTORY_DAYS = 14;
const LOGIN_CADENCE_MS = 2_000;
// Шлюз может не ответить на шаг входа вовсе (упал, не поднялся) — через
// минуту молчания предлагаем попробовать снова, а не ждём бесконечно
const LOGIN_STEP_TIMEOUT_MS = 60_000;

type Draft = {
  proxyUrl: string;
  proxyPassword: string;
  apiId: string;
  apiHash: string;
  historyOn: boolean;
  historyDays: number;
  markReadOnOpen: boolean;
  signReplies: boolean;
};

const draftOf = (channel: MessagingChannel): Draft => ({
  proxyUrl: channel.settings.proxyUrl ?? "",
  proxyPassword: "",
  apiId: "",
  apiHash: "",
  historyOn: historyEnabled(channel.settings),
  historyDays: channel.settings.historyDays || DEFAULT_HISTORY_DAYS,
  markReadOnOpen: channel.settings.markReadOnOpen !== false,
  signReplies: channel.settings.signReplies !== false,
});

type ProxyCheck =
  | { state: "idle" }
  | { state: "busy"; jobId: string }
  | { state: "ok"; latencyMs: number | null }
  | { state: "error"; error: string };

type LoginStep = "phone" | "code" | "password";

/**
 * Шаг входа (телефон/код/пароль) ушёл на сервер как заданиe очереди (`jobId`).
 * Диалог держит «ждём ответа», пока задание не закроется (`GET
 * …/jobs/:jobId` на теме «channels», как у проверки прокси) — это ловит и
 * успех, и отказ (неверный код/пароль), при котором `channel.state`/стадия не
 * сдвигаются вовсе. Сдвиг состояния (util/channel-state#loginStepPending) —
 * запасной путь на случай будущих шагов без задания; таймаут — последний.
 */
type LoginStepStatus =
  | { phase: "idle" }
  | {
      phase: "pending";
      step: LoginStep;
      since: { state: string; stage: string };
      jobId: string;
    }
  | { phase: "timedOut"; step: LoginStep }
  | { phase: "failed"; step: LoginStep; error: string };

const toast = (variant: "success" | "danger", message: string) =>
  useToastStore.getState().showToast(variant, message);

const OptionRow = ({
  id,
  title,
  hint,
  checked,
  onChange,
  first = false,
}: {
  id: string;
  title: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  first?: boolean;
}) => (
  <div
    className={cn(
      "flex items-center gap-3 py-2.5",
      !first && "border-t border-border-soft",
    )}
  >
    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
      <span className="block text-sm font-semibold">{title}</span>
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </label>
    <Switch id={id} checked={checked} onCheckedChange={onChange} />
  </div>
);

const QrBox = ({ children }: { children: ReactNode }) => (
  <div className="grid size-54 place-items-center rounded-xl border border-border bg-white">
    {children}
  </div>
);

/** Строка ошибки под формой шага входа — один стиль на все три источника. */
const StepError = ({ text }: { text: string }) =>
  text ? (
    <p className="mt-2 mb-0 text-center text-sm text-destructive">{text}</p>
  ) : null;

const TelegramChannelDialog = ({
  channel,
  onOpenChange,
  organization,
  onChanged,
}: {
  /** Открытый канал; `null` — диалог закрыт. */
  channel: MessagingChannel | null;
  onOpenChange: (open: boolean) => void;
  organization: string;
  onChanged: () => Promise<void> | void;
}) => {
  const me = useAuthedUser();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [codeLogin, setCodeLogin] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [proxy, setProxy] = useState<ProxyCheck>({ state: "idle" });
  const [loginStepStatus, setLoginStepStatus] = useState<LoginStepStatus>({ phase: "idle" });
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const channelId = channel?.id ?? null;
  // Другой канал или новое открытие — поля с сервера, вход с начала
  useEffect(() => {
    if (!channel) return;
    setDraft(draftOf(channel));
    setCodeLogin(false);
    setPhone("");
    setCode("");
    setPassword("");
    setProxy({ state: "idle" });
    setLoginStepStatus({ phase: "idle" });
  }, [channelId]);

  const stage = loginStage(channel);
  // Шаг входа ещё «в полёте» — state/стадия не сдвинулись с отправки
  const loginPending =
    loginStepStatus.phase === "pending" &&
    loginStepPending(loginStepStatus.since, channel);
  const waitingGateway =
    stage === "waiting" || stage === "qr" || proxy.state === "busy" || loginPending;

  // Пока ждём шлюз — пульс чаще, чтобы QR, итог проверки и шаг входа приходили быстро
  useEffect(() => {
    if (!channel || !waitingGateway) return undefined;
    return usePulseStore.getState().requestCadence(LOGIN_CADENCE_MS);
  }, [channel, waitingGateway]);

  // Состояние или стадия сдвинулись — шлюз шаг входа обработал (успешно или
  // с ошибкой, это уже видно по новому состоянию); диалог закрылся (channel —
  // null) считается тем же самым сдвигом (util/channel-state#loginStepPending)
  useEffect(() => {
    if (loginStepStatus.phase === "pending" && !loginPending) {
      setLoginStepStatus({ phase: "idle" });
    }
  }, [loginStepStatus, loginPending]);

  // Шлюз может не ответить на шаг вовсе — через минуту предлагаем попробовать
  // снова, а не держим спиннер бесконечно (часы экрана, не опрос данных)
  useEffect(() => {
    if (loginStepStatus.phase !== "pending") return undefined;
    const timer = setTimeout(() => {
      setLoginStepStatus((current) =>
        current.phase === "pending" ? { phase: "timedOut", step: current.step } : current,
      );
    }, LOGIN_STEP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loginStepStatus]);

  // Итог проверки прокси: задание шлюзу закрывается — тема «channels» движется
  useLiveTopic(
    "channels",
    async () => {
      if (!channel || proxy.state !== "busy") return;
      const { job } = await api<{ job: ChannelJobView }>(
        `/api/channels/${channel.id}/jobs/${proxy.jobId}`,
      );
      if (job.state === "done") {
        const latency = (job.result as { latencyMs?: number } | null)?.latencyMs;
        setProxy({ state: "ok", latencyMs: typeof latency === "number" ? latency : null });
      } else if (job.state === "failed" || job.state === "cancelled") {
        setProxy({ state: "error", error: job.error || "Прокси не отвечает" });
      }
    },
    { enabled: proxy.state === "busy" },
  );

  // Итог шага входа: то же самое задание, той же темой. Неверный код или
  // пароль не двигает channel.state (шлюз оставляет ту же стадию) — без этого
  // спросить у самого задания форма спинила бы все 60 с до таймаута
  useLiveTopic(
    "channels",
    async () => {
      if (!channel || loginStepStatus.phase !== "pending") return;
      const { jobId, step } = loginStepStatus;
      const { job } = await api<{ job: ChannelJobView }>(
        `/api/channels/${channel.id}/jobs/${jobId}`,
      );
      if (job.state === "done") {
        setLoginStepStatus({ phase: "idle" });
      } else if (job.state === "failed" || job.state === "cancelled") {
        setLoginStepStatus({ phase: "failed", step, error: job.error || "Telegram не ответил" });
      }
    },
    { enabled: loginStepStatus.phase === "pending" },
  );

  // Обратный отсчёт QR — часы экрана, не опрос данных
  useEffect(() => {
    if (stage !== "qr") return undefined;
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, [stage]);

  if (!channel || !draft) return null;

  const patch = (values: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...values } : current));

  const keysSet = channel.secrets.tgApiId && channel.secrets.tgApiHash;
  const keysReady = Boolean(keysSet || (draft.apiId.trim() && draft.apiHash.trim()));

  /**
   * Настройки и непустые секреты — в канал. Пустой секрет значит «не менять».
   * Пароль прокси внутри самого URL («scheme://user:pass@host», вставили
   * строкой целиком) уходит отдельным секретом — в `settings.proxyUrl`
   * остаётся только «user@host», иначе пароль лежал бы открытым текстом и
   * снова показался бы в этом же поле при следующем открытии диалога.
   */
  const save = async () => {
    const secrets: Record<string, string> = {};
    if (draft.apiId.trim()) secrets.tgApiId = draft.apiId.trim();
    if (draft.apiHash.trim()) secrets.tgApiHash = draft.apiHash.trim();
    const { url: proxyUrl, password: inlineProxyPassword } = splitProxyPassword(
      draft.proxyUrl.trim(),
    );
    if (draft.proxyPassword) secrets.proxyPassword = draft.proxyPassword;
    else if (inlineProxyPassword) secrets.proxyPassword = inlineProxyPassword;
    await api(`/api/channels/${channel.id}`, {
      method: "PATCH",
      body: {
        settings: {
          proxyUrl,
          historyDays: draft.historyOn ? draft.historyDays : 0,
          markReadOnOpen: draft.markReadOnOpen,
          signReplies: draft.signReplies,
        },
        ...(Object.keys(secrets).length ? { secrets } : {}),
      },
    });
    patch({ apiId: "", apiHash: "", proxyPassword: "", proxyUrl });
  };

  /** Действие со шлюзом: сперва сохранить введённое, потом команда. */
  const run = async (request: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await save();
      await request();
      await onChanged();
    } catch (error) {
      toast("danger", failureText(error, failed));
    } finally {
      setBusy(false);
    }
  };

  const loginStep = (step: "start" | "phone" | "code" | "password", value?: string) =>
    run(
      async () => {
        const { jobId } = await api<{ jobId: string }>(`/api/channels/${channel.id}/login`, {
          method: "POST",
          body: value === undefined ? { step } : { step, value },
        });
        // «start» получает `connecting` синхронно на сервере — это уже видно
        // через waitingGateway (stage === "waiting"). Для остальных шагов
        // бэкенд не пишет промежуточное состояние синхронно — ждём итог
        // задания (выше) до сдвига состояния/стадии или до таймаута.
        if (step !== "start") {
          setLoginStepStatus({
            phase: "pending",
            step,
            since: { state: channel.state, stage },
            jobId,
          });
        }
      },
      "Не удалось передать шлюзу шаг входа",
    );

  const checkProxy = async () => {
    setBusy(true);
    try {
      await save();
      const { jobId } = await api<{ jobId: string }>(`/api/channels/${channel.id}/test`, {
        method: "POST",
      });
      setProxy({ state: "busy", jobId });
    } catch (error) {
      setProxy({ state: "error", error: failureText(error, "Проверка не запустилась") });
    } finally {
      setBusy(false);
    }
  };

  const saveAndClose = async () => {
    setBusy(true);
    try {
      await save();
      await onChanged();
      toast("success", "Канал сохранён");
      onOpenChange(false);
    } catch (error) {
      toast("danger", failureText(error, "Не удалось сохранить канал"));
    } finally {
      setBusy(false);
    }
  };

  const logout = () =>
    run(
      () => api(`/api/channels/${channel.id}/logout`, { method: "POST" }),
      "Не удалось выйти из аккаунта",
    ).then(() => setConfirmLogout(false));

  const seconds = qrSecondsLeft(channel.login.expiresAt, now);
  const account = channel.account;

  const subtitle =
    stage === "connected"
      ? "Клиенты пишут на этот аккаунт — ответы уходят из HD."
      : channel.state === "loggedOut"
        ? "Сессия завершена — войдите заново, переписка сохранится."
        : "Войдите корпоративным аккаунтом — переписка с клиентами появится в «Диалогах».";

  // Ждём ответа шлюза на этот шаг — форма занята, кнопка со спиннером
  const pendingFor = (step: LoginStep) =>
    loginStepStatus.phase === "pending" && loginStepStatus.step === step;
  // Минута прошла без ответа — форма свободна, под ней просьба повторить
  const timedOutFor = (step: LoginStep) =>
    loginStepStatus.phase === "timedOut" && loginStepStatus.step === step;
  // Задание отказало (неверный код/пароль и т.п.) — текст из самого задания
  const failedError = (step: LoginStep) =>
    loginStepStatus.phase === "failed" && loginStepStatus.step === step
      ? loginStepStatus.error
      : "";

  // Левая колонка — вход по стадиям (util/channel-state#loginStage)
  const loginPanel = (() => {
    if (stage === "connected") {
      return (
        <div className="rounded-xl border border-border p-4">
          <ChannelTile network="telegram" iconSize={22} className="size-11 rounded-xl" />
          <div className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-accent-text">
            <RiCheckLine size={16} aria-hidden />
            Подключён
          </div>
          <div className="mt-0.5 truncate text-sm font-medium">
            {account.displayName || "Корпоративный аккаунт"}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {account.phone || (account.username ? `@${account.username}` : "")}
          </div>
          <Button
            variant="ghost"
            size="xs"
            className="mt-3 -ml-2 text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => setConfirmLogout(true)}
          >
            Выйти из аккаунта
          </Button>
        </div>
      );
    }
    if (stage === "code") {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim()) void loginStep("code", code.trim());
          }}
        >
          <Field label="Код из Telegram или SMS" htmlFor="tg-login-code">
            <Input
              id="tg-login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              disabled={pendingFor("code")}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !code.trim() || pendingFor("code")}
          >
            {pendingFor("code") ? (
              <>
                <RiLoader4Line size={16} aria-hidden className="animate-spin" />
                Ждём Telegram…
              </>
            ) : (
              "Войти"
            )}
          </Button>
          <StepError
            text={timedOutFor("code") ? "Telegram не ответил — попробуйте ещё раз" : ""}
          />
          <StepError text={failedError("code")} />
          <StepError text={channel.stateReason} />
        </form>
      );
    }
    if (stage === "password") {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (password) void loginStep("password", password);
          }}
        >
          <Field
            label="Пароль двухэтапной проверки"
            htmlFor="tg-login-password"
            hint="Облачный пароль аккаунта Telegram"
          >
            <PasswordInput
              id="tg-login-password"
              autoComplete="current-password"
              value={password}
              disabled={pendingFor("password")}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !password || pendingFor("password")}
          >
            {pendingFor("password") ? (
              <>
                <RiLoader4Line size={16} aria-hidden className="animate-spin" />
                Ждём Telegram…
              </>
            ) : (
              "Войти"
            )}
          </Button>
          <StepError
            text={timedOutFor("password") ? "Telegram не ответил — попробуйте ещё раз" : ""}
          />
          <StepError text={failedError("password")} />
          <StepError text={channel.stateReason} />
        </form>
      );
    }
    if (codeLogin) {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (phone.trim()) void loginStep("phone", phone.trim());
          }}
        >
          <Field label="Номер телефона" htmlFor="tg-login-phone">
            <Input
              id="tg-login-phone"
              type="tel"
              autoComplete="tel"
              placeholder="+7 900 000-00-00"
              value={phone}
              disabled={pendingFor("phone")}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !phone.trim() || !keysReady || pendingFor("phone")}
          >
            {pendingFor("phone") ? (
              <>
                <RiLoader4Line size={16} aria-hidden className="animate-spin" />
                Ждём Telegram…
              </>
            ) : (
              "Получить код"
            )}
          </Button>
          {timedOutFor("phone") && (
            <p className="mt-2 mb-0 text-center text-sm text-destructive">
              Telegram не ответил — попробуйте ещё раз
            </p>
          )}
          <button
            type="button"
            onClick={() => setCodeLogin(false)}
            className="mt-2 w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-center text-sm font-semibold text-accent-text"
          >
            Войти по QR-коду
          </button>
        </form>
      );
    }
    return (
      <>
        <QrBox>
          {stage === "qr" && channel.login.qr ? (
            <QrCode data={channel.login.qr} size={168} />
          ) : stage === "waiting" ? (
            <span className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
              <RiLoader4Line size={24} aria-hidden className="animate-spin text-primary" />
              Получаем код…
            </span>
          ) : (
            <span className="flex flex-col items-center gap-2 px-4 text-center">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !keysReady}
                onClick={() => void loginStep("start")}
              >
                <RiQrCodeLine />
                Получить QR-код
              </Button>
              {!keysReady && (
                <span className="text-xs text-muted-foreground">
                  Сначала укажите ключи приложения
                </span>
              )}
            </span>
          )}
        </QrBox>
        {stage === "qr" && seconds !== null && (
          <div className="mt-2.5 text-center text-xs text-muted-foreground">
            {seconds > 0 ? `Код обновится через ${seconds} с` : "Код обновляется…"}
          </div>
        )}
        <div className="mt-1 text-center">
          <button
            type="button"
            onClick={() => setCodeLogin(true)}
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm font-semibold text-accent-text"
          >
            Войти по коду из SMS
          </button>
        </div>
        {channel.state === "error" && channel.stateReason && (
          <p className="mt-2 mb-0 text-center text-sm text-destructive">
            {channel.stateReason}
          </p>
        )}
      </>
    );
  })();

  const steps = [
    "Откройте Telegram на корпоративном телефоне.",
    "Настройки → Устройства → Подключить устройство.",
    "Наведите камеру на код слева.",
  ];

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="block max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-170">
          <DialogTitle className="text-lg leading-7 font-semibold">
            Telegram — вход
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {subtitle}
          </DialogDescription>

          <div className="mt-5 flex flex-col gap-6 md:flex-row">
            <div className="w-full flex-none md:w-54">{loginPanel}</div>
            <div className="min-w-0 flex-1">
              {stage !== "connected" && !codeLogin && stage !== "code" && stage !== "password" && (
                <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {steps.map((step, index) => (
                    <li key={step} className="flex gap-2.5 text-sm">
                      <span className="grid size-5 flex-none place-items-center rounded-full bg-accent text-xs font-semibold text-muted-foreground">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}

              {!keysSet && (
                <div className="mt-4.5">
                  <div className="mb-1.5 text-sm font-semibold text-muted-foreground">
                    Ключи приложения Telegram
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      aria-label="api_id"
                      placeholder="api_id"
                      value={draft.apiId}
                      onChange={(event) => patch({ apiId: event.target.value })}
                    />
                    <Input
                      aria-label="api_hash"
                      placeholder="api_hash"
                      value={draft.apiHash}
                      onChange={(event) => patch({ apiHash: event.target.value })}
                    />
                  </div>
                  <p className="mt-1.5 mb-0 text-sm text-muted-foreground">
                    my.telegram.org → API development tools
                  </p>
                </div>
              )}

              <label htmlFor="tg-proxy" className="mt-4.5 block">
                <span className="mb-1.5 block text-sm font-semibold text-muted-foreground">
                  Прокси
                </span>
                <span className="flex gap-2">
                  <Input
                    id="tg-proxy"
                    placeholder="socks5://host:1080"
                    value={draft.proxyUrl}
                    onChange={(event) => {
                      patch({ proxyUrl: event.target.value });
                      setProxy({ state: "idle" });
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || proxy.state === "busy" || !draft.proxyUrl.trim()}
                    onClick={() => void checkProxy()}
                  >
                    Проверить
                  </Button>
                </span>
              </label>
              {draft.proxyUrl.includes("@") && (
                <Field
                  label="Пароль прокси"
                  htmlFor="tg-proxy-password"
                  hint={channel.secrets.proxyPassword ? "Задан — пусто значит «не менять»" : undefined}
                  className="mt-3 mb-0"
                >
                  <PasswordInput
                    id="tg-proxy-password"
                    autoComplete="new-password"
                    value={draft.proxyPassword}
                    onChange={(event) => patch({ proxyPassword: event.target.value })}
                  />
                </Field>
              )}
              {proxy.state !== "idle" && (
                <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                  {proxy.state === "busy" && (
                    <>
                      <RiLoader4Line size={16} aria-hidden className="animate-spin" />
                      Проверяем…
                    </>
                  )}
                  {proxy.state === "ok" && (
                    <>
                      <RiCheckLine size={16} aria-hidden className="text-accent-text" />
                      <span>
                        <span className="font-semibold text-accent-text">Прокси отвечает</span>
                        {proxy.latencyMs !== null && ` · ${proxy.latencyMs} мс`}
                      </span>
                    </>
                  )}
                  {proxy.state === "error" && (
                    <>
                      <RiErrorWarningLine size={16} aria-hidden className="text-destructive" />
                      <span>
                        <span className="font-semibold text-destructive">Прокси не отвечает</span>
                        {` · ${proxy.error}`}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 border-t border-border-soft pt-1.5">
            <OptionRow
              id="tg-history"
              first
              title={`Загрузить историю за ${draft.historyDays} ${plural(draft.historyDays, "день", "дня", "дней")}`}
              hint="Только текст; вложения — по клику"
              checked={draft.historyOn}
              onChange={(value) => patch({ historyOn: value })}
            />
            <OptionRow
              id="tg-mark-read"
              title="Отмечать прочитанным при открытии"
              hint="Клиент видит, что его сообщение прочитали"
              checked={draft.markReadOnOpen}
              onChange={(value) => patch({ markReadOnOpen: value })}
            />
            <OptionRow
              id="tg-sign"
              title="Подписывать ответы"
              hint={signatureExample(me.firstName ?? "", organization)}
              checked={draft.signReplies}
              onChange={(value) => patch({ signReplies: value })}
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button disabled={busy} onClick={() => void saveAndClose()}>
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Выйти из аккаунта Telegram?"
        description="Новые сообщения перестанут приходить в «Диалоги», пока не войдёте снова. Переписка сохранится."
        confirmLabel="Выйти"
        confirmVariant="destructive"
        isLoading={busy}
        onConfirm={() => void logout()}
      />
    </>
  );
};

export default TelegramChannelDialog;
