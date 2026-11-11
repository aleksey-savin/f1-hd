import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { RiRefreshLine } from "react-icons/ri";

import Field from "@/components/app/Field";
import HealthRow from "@/components/app/HealthRow";
import PasswordInput from "@/components/app/PasswordInput";
import { SubLabel } from "@/components/app/Panel";
import SettingRow from "@/components/app/SettingRow";
import type { DraftPayload } from "@/components/app/draft-context";
import { ChannelIcon } from "@/components/Conversation/ChannelGlyph";
import { failureText } from "@/components/Conversation/conversation-actions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import useLiveTopic from "@/hooks/use-live-topic";
import { api } from "@/lib/api";
import { formatPhone } from "@/util/phone";
import { formatAgo } from "@/util/format-date";

import SectionForm from "./SectionForm";

export type WazzupAccount = {
  id: string;
  type: "telegram" | "whatsapp" | "max";
  transport: string;
  name: string;
  account: string;
  state: string;
  reason: string;
};

export type WazzupSettings = {
  isActive: boolean;
  apiKeyIsSet: boolean;
  channelIds: string[];
  accounts: WazzupAccount[];
  health: {
    lastCheckedAt: string | null;
    lastOkAt: string | null;
    lastMessageAt: string | null;
    lastError: string;
    lastErrorHint: string;
    lastErrorAt: string | null;
  };
  webhookConnected: boolean;
};

type CheckResult = { accounts: WazzupAccount[]; message: string };
const networkNames = { telegram: "Telegram", whatsapp: "WhatsApp", max: "MAX" };
const tiles = {
  telegram:
    "bg-channel-telegram-tint text-channel-telegram inset-ring-transparent",
  whatsapp:
    "bg-channel-whatsapp-tint text-channel-whatsapp inset-ring-transparent",
  max: "bg-channel-max-tint text-channel-max inset-ring-transparent",
};

export default function Wazzup({
  settings,
  additionalDraft,
}: {
  settings?: WazzupSettings;
  additionalDraft?: { payload: DraftPayload; blockedReason?: string | null };
}) {
  // Метаданные сервера обновляются отдельно от пользовательского черновика.
  const [server, setServer] = useState({ value: settings, revision: 0 });
  const sequence = useRef(0);
  const liveRequest = useRef<AbortController | null>(null);
  const [isActive, setActive] = useState(settings?.isActive ?? false);
  const [apiKey, setKey] = useState("");
  const [channelIds, setChannelIds] = useState(settings?.channelIds ?? []);
  const [result, setResult] = useState<
    (CheckResult & { at: string; revision: number }) | null
  >(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
      liveRequest.current?.abort();
      liveRequest.current = null;
    },
    [],
  );

  const reloadMetadata = useCallback(async () => {
    liveRequest.current?.abort();
    const controller = new AbortController();
    liveRequest.current = controller;
    try {
      const data = await api<{ wazzup: WazzupSettings }>(
        "/api/preferences/wazzup",
        {
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted && liveRequest.current === controller) {
        setServer({ value: data.wazzup, revision: ++sequence.current });
      }
    } catch {
      // Тихое обновление сохраняет последний снимок и результат ручной проверки.
    } finally {
      if (liveRequest.current === controller) liveRequest.current = null;
    }
  }, []);
  useLiveTopic("channels", reloadMetadata);
  const metadata = server.value;

  const changeKey = (value: string) => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setKey(value);
    setResult(null);
    setError("");
    // Результат проверки другого ключа не становится частью нового черновика.
    setChannelIds((current) =>
      current.filter((id) => settings?.channelIds.includes(id)),
    );
  };

  const check = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const data = await api<CheckResult>("/api/preferences/wazzup/check", {
        method: "POST",
        body: { apiKey },
        signal: controller.signal,
      });
      if (!controller.signal.aborted)
        setResult({
          ...data,
          at: new Date().toISOString(),
          revision: ++sequence.current,
        });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(failureText(cause, "Не удалось проверить доступ к Wazzup"));
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };

  // При недоступном API сохранённые аккаунты остаются в списке и черновике.
  const accounts = new Map(
    (metadata?.accounts ?? []).map((account) => [account.id, account]),
  );
  for (const account of result?.accounts ?? [])
    accounts.set(account.id, account);
  // Проверка нового ключа важнее сохранённых метаданных; для сохранённого
  // ключа более свежий pulse обновляет состояние аккаунтов и реальную работу.
  const savedHealth = !apiKey.trim();
  const newerMetadata =
    savedHealth && result && server.revision > result.revision;
  if (newerMetadata) {
    for (const account of metadata?.accounts ?? [])
      accounts.set(account.id, account);
  }
  const health = metadata?.health;
  const lastHealthAt = Math.max(
    0,
    ...[
      health?.lastCheckedAt,
      health?.lastOkAt,
      health?.lastMessageAt,
      health?.lastErrorAt,
    ].map((value) => (value ? Date.parse(value) || 0 : 0)),
  );
  // Pulse без нового факта работы не отменяет успешную ручную проверку API.
  const visibleResult =
    newerMetadata && result && lastHealthAt > Date.parse(result.at)
      ? null
      : result;
  const blockedReason = !isActive
    ? null
    : !apiKey.trim() && !metadata?.apiKeyIsSet
      ? "Укажите API-ключ Wazzup"
      : channelIds.length === 0
        ? "Выберите хотя бы один аккаунт Wazzup"
        : null;
  const canCheck =
    isActive && (Boolean(apiKey.trim()) || Boolean(metadata?.apiKeyIsSet));
  const hasSavedError = savedHealth && Boolean(health?.lastError);
  const hasMessage = savedHealth && Boolean(health?.lastMessageAt);
  const apiConfirmed =
    Boolean(visibleResult) || (savedHealth && Boolean(health?.lastOkAt));
  const state = !isActive
    ? "idle"
    : busy
      ? "busy"
      : error
        ? "error"
        : visibleResult
          ? "ok"
          : hasSavedError
            ? "error"
            : hasMessage || apiConfirmed
              ? "ok"
              : "warning";
  const title = !isActive
    ? "Wazzup выключен"
    : busy
      ? "Проверяем доступ к Wazzup"
      : error ||
        (visibleResult
          ? "Доступ к API подтверждён"
          : hasSavedError
            ? health?.lastError
            : hasMessage
              ? "Сообщения поступают"
              : apiConfirmed
                ? "Доступ к API подтверждён"
                : "Подключение не проверено");
  const at =
    visibleResult?.at ||
    (savedHealth
      ? hasSavedError
        ? health?.lastErrorAt
        : health?.lastMessageAt || health?.lastOkAt || health?.lastCheckedAt
      : null);
  const webhookHint =
    savedHealth && metadata?.webhookConnected
      ? "Приём событий Wazzup подключён."
      : "Приём событий подключается после сохранения настроек.";
  const hint = !isActive
    ? "Приём сообщений и отправка ответов через Wazzup отключены"
    : error
      ? "Проверка не сохраняет настройки. Сохранённые аккаунты доступны для выбора."
      : visibleResult
        ? `${visibleResult.message} Проверка подтверждает доступ к API. ${webhookHint}`
        : hasSavedError
          ? health?.lastErrorHint
          : savedHealth && apiConfirmed
            ? `${webhookHint} Проверка использует сохранённый ключ и не сохраняет настройки.`
            : "Проверка использует введённый или сохранённый ключ и не сохраняет настройки.";

  return (
    <>
      <div className="border-t border-border-soft px-5 pt-5 pb-1">
        <SubLabel>Через Wazzup</SubLabel>
      </div>
      <SectionForm
        blockedReason={blockedReason || additionalDraft?.blockedReason || null}
        buildPayload={() => ({
          ...additionalDraft?.payload,
          wazzup: { isActive, apiKey, channelIds },
        })}
      >
        <SettingRow
          title="Подключить Wazzup"
          hint="Использовать аккаунты Wazzup для переписки в Диалогах"
          htmlFor="prefs-wazzup-active"
        >
          <Switch
            id="prefs-wazzup-active"
            checked={isActive}
            onCheckedChange={setActive}
          />
        </SettingRow>
        <div className="px-5 pb-1">
          <Field
            label="API-ключ Wazzup"
            htmlFor="prefs-wazzup-key"
            hint="Wazzup → Интеграция с CRM → API. Пустое поле оставляет сохранённый ключ без изменений."
          >
            <PasswordInput
              id="prefs-wazzup-key"
              value={apiKey}
              disabled={!isActive}
              autoComplete="new-password"
              placeholder={
                metadata?.apiKeyIsSet ? "•••••••• (задан)" : "Введите API-ключ"
              }
              onChange={(event) => changeKey(event.target.value)}
            />
          </Field>
        </div>
        <SettingRow
          title="Аккаунты из Wazzup"
          hint="Выберите, с каких аккаунтов принимать сообщения и отправлять ответы клиентам."
          divider
        >
          <Button
            size="sm"
            variant="outline"
            disabled={!canCheck || busy}
            onClick={() => void check()}
          >
            <RiRefreshLine className={busy ? "animate-spin" : undefined} />
            {accounts.size ? "Обновить список" : "Загрузить список"}
          </Button>
        </SettingRow>
        {accounts.size === 0 && (
          <p className="m-0 px-5 pb-4 text-sm text-muted-foreground">
            {result
              ? "В Wazzup нет доступных аккаунтов. Подключите аккаунт в Wazzup и обновите список."
              : "Загрузите список аккаунтов по API-ключу Wazzup."}
          </p>
        )}
        {[...accounts.values()].map((account) => (
          <Fragment key={account.id}>
            <SettingRow
              divider
              title={
                account.name && account.name !== networkNames[account.type]
                  ? `${networkNames[account.type]} — ${account.name}`
                  : networkNames[account.type]
              }
              htmlFor={`prefs-wazzup-account-${account.id}`}
              hint={`${(/^[+\d\s().-]+$/.test(account.account) ? formatPhone(account.account) : account.account) || networkNames[account.type]} · через Wazzup`}
              leading={
                <ChannelIcon
                  network={account.type}
                  size={18}
                  className="text-inherit"
                />
              }
              leadingClassName={tiles[account.type]}
            >
              <Switch
                id={`prefs-wazzup-account-${account.id}`}
                checked={channelIds.includes(account.id)}
                disabled={!isActive}
                onCheckedChange={(checked) =>
                  setChannelIds((current) =>
                    checked
                      ? [...current, account.id]
                      : current.filter((id) => id !== account.id),
                  )
                }
              />
            </SettingRow>
            <HealthRow
              state={
                account.state === "active"
                  ? "ok"
                  : ["init", "onModeration"].includes(account.state)
                    ? "info"
                    : "warning"
              }
              title={account.reason || "Проверьте состояние аккаунта в Wazzup"}
              hint="Вход и состояние этого аккаунта управляются в Wazzup."
            />
          </Fragment>
        ))}
        <SettingRow
          divider
          title="Переписка в Диалогах"
          hint="После сохранения новые сообщения выбранных аккаунтов появятся в Диалогах. Ответы сотрудников уйдут клиенту с того же аккаунта."
        />
      </SectionForm>
      <HealthRow
        state={state}
        title={title}
        meta={isActive && !busy && !error && at ? formatAgo(at) : undefined}
        hint={hint}
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={!canCheck || busy}
            onClick={() => void check()}
          >
            <RiRefreshLine className={busy ? "animate-spin" : undefined} />
            Проверить
          </Button>
        }
      />
    </>
  );
}
