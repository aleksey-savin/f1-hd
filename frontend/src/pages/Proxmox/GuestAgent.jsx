import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import FormSheet from "@/components/app/FormSheet";
import { FormActions } from "@/components/app/FormLayout";
import SettingRow from "@/components/app/SettingRow";
import Combobox from "@/components/app/Combobox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Section, Properties, Feedback, date } from "./shared";
import {
  guestAgentState,
  guestAgentLabel,
  guestAgentTone,
  guestAgentSettings,
  guestAgentNeedsRestart,
  guestAgentSaveSucceeded,
} from "./guest-agent-presentation";

const optionLabel = (value, enabled, disabled) =>
  value === true ? enabled : value === false ? disabled : "Нет данных";

export function GuestAgentPanel({ item, canManage, onEdit }) {
  const agent = item.guestAgent;
  const state = guestAgentState(item);
  const onlyState = ["disabled", "notApplicable"].includes(state);
  return (
    <Section
      id="agent"
      title="QEMU Guest Agent"
      action={
        canManage && item.guestType === "qemu" && onEdit ? (
          <Button variant="outline" size="sm" onClick={onEdit}>
            Изменить
          </Button>
        ) : null
      }
    >
      {onlyState ? (
        <p className={`text-sm ${guestAgentTone(item)}`}>
          {guestAgentLabel(item)}
        </p>
      ) : (
        <>
          <Properties
            items={[
              [
                "Состояние агента",
                <span key="state" className={guestAgentTone(item)}>
                  {guestAgentLabel(item)}
                </span>,
              ],
              ["Версия агента", agent?.version || "—"],
              ...(agent?.checkedAt
                ? [["Проверено", date(agent.checkedAt)]]
                : []),
              [
                "TRIM после переноса/миграции",
                optionLabel(
                  agent?.settings?.trimClonedDisks,
                  "Включён",
                  "Выключен",
                ),
              ],
              [
                "Заморозка файловой системы",
                optionLabel(
                  agent?.settings?.freezeFilesystem,
                  "Включена",
                  "Выключена",
                ),
              ],
              [
                "Канал агента",
                agent?.settings?.type === "virtio"
                  ? "VirtIO"
                  : agent?.settings?.type === "isa"
                    ? "ISA"
                    : "Нет данных",
              ],
            ]}
          />
          {state === "restartRequired" && item.status === "running" ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Перезапустите ВМ через Proxmox, чтобы применить изменение. Обычная
              перезагрузка внутри гостевой ОС может не применить его.
            </p>
          ) : item.status === "stopped" ? (
            <p className="mt-4 text-sm text-muted-foreground">
              ВМ остановлена; проверить агент сейчас нельзя.
            </p>
          ) : agent?.lastError ? (
            <p className="mt-4 text-sm text-warning-text">{agent.lastError}</p>
          ) : null}
        </>
      )}
    </Section>
  );
}

function GuestAgentForm({ item, enable, onOpenChange, onSaved }) {
  const fetcher = useFetcher();
  const [settings, setSettings] = useState(() =>
    guestAgentSettings(item, enable),
  );
  const [submitted, setSubmitted] = useState(false);
  const pending = useRef(null);
  const prefix = useId();
  const busy = fetcher.state !== "idle";
  const response =
    submitted &&
    fetcher.data?.intent === "guestAgent" &&
    String(fetcher.data.resourceId) === String(item.id)
      ? fetcher.data
      : null;
  useEffect(() => {
    if (!pending.current || busy || fetcher.data === pending.current.previous)
      return;
    if (guestAgentSaveSucceeded(fetcher.data, pending.current.resourceId)) {
      pending.current = null;
      onOpenChange(false);
      onSaved?.(fetcher.data);
    }
  }, [busy, fetcher.data, onOpenChange, onSaved]);
  const setOption = (key, value) =>
    setSettings((current) => ({ ...current, [key]: value }));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        pending.current = { resourceId: item.id, previous: fetcher.data };
        setSubmitted(true);
        fetcher.submit(
          { intent: "guestAgent", resourceId: item.id, ...settings },
          { method: "post", encType: "application/json" },
        );
      }}
    >
      <h2 className="mb-1 pr-10 text-xl font-semibold tracking-tight">
        Изменить параметры Guest Agent
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">{item.name}</p>
      <Feedback data={response?.error ? response : null} />
      {[
        [
          "enabled",
          "Включить Guest Agent",
          "Разрешить обмен с QEMU Guest Agent внутри ВМ.",
        ],
        [
          "trimClonedDisks",
          "TRIM после переноса или миграции",
          "Освобождать неиспользуемые блоки дисков через агент.",
        ],
        [
          "freezeFilesystem",
          "Замораживать файловую систему",
          "Приостановить запись на время создания согласованной резервной копии.",
        ],
      ].map(([key, title, hint]) => (
        <SettingRow
          key={key}
          title={title}
          hint={hint}
          htmlFor={`${prefix}-${key}`}
        >
          <Switch
            id={`${prefix}-${key}`}
            checked={settings[key]}
            disabled={busy || (key !== "enabled" && !settings.enabled)}
            onCheckedChange={(value) => setOption(key, value)}
          />
        </SettingRow>
      ))}
      <SettingRow
        title="Канал агента"
        hint="Способ подключения QEMU Guest Agent к виртуальной машине."
        htmlFor={`${prefix}-channel`}
      >
        <Combobox
          id={`${prefix}-channel`}
          ariaLabel="Канал агента"
          clearable={false}
          value={settings.type}
          disabled={busy || !settings.enabled}
          options={[
            { value: "virtio", label: "VirtIO" },
            { value: "isa", label: "ISA" },
          ]}
          onChange={(value) => setOption("type", value)}
        />
      </SettingRow>
      {guestAgentNeedsRestart(item, settings) && (
        <p className="mt-4 text-sm text-muted-foreground">
          Чтобы применить изменение, потребуется перезапустить ВМ через Proxmox.
          Обычная перезагрузка внутри гостевой ОС может не применить его.
        </p>
      )}
      <FormActions>
        <Button
          variant="ghost"
          type="button"
          onClick={() => onOpenChange(false)}
        >
          Отмена
        </Button>
        <Button className="ml-auto" type="submit" disabled={busy}>
          {busy ? "Сохранение…" : "Сохранить"}
        </Button>
      </FormActions>
    </form>
  );
}

export function GuestAgentSheet({
  item,
  open,
  onOpenChange,
  enable = false,
  onSaved,
}) {
  return (
    <FormSheet
      open={open && item?.guestType === "qemu"}
      onOpenChange={onOpenChange}
      title="Изменить параметры Guest Agent"
    >
      {open && item?.guestType === "qemu" && (
        <GuestAgentForm
          key={`${item.id}:${enable}`}
          item={item}
          enable={enable}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      )}
    </FormSheet>
  );
}

export {
  guestAgentLabel,
  guestAgentState,
  guestAgentTone,
} from "./guest-agent-presentation";
