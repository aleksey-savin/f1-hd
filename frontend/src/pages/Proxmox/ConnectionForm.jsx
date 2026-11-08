import { useContext, useEffect, useState } from "react";
import { useFetcher, useLoaderData, useParams } from "react-router";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiShieldCheckLine,
  RiInformationLine,
} from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Field from "@/components/app/Field";
import Discovery from "./Discovery";
import ChoiceGroup from "@/components/app/ChoiceGroup";
import Combobox from "@/components/app/Combobox";
import WizardStepper from "@/components/app/WizardStepper";
import AlertMessage from "@/components/app/AlertMessage";
import {
  FormActions,
  FormHeader,
  FormSections,
  sectionAnchorId,
} from "@/components/app/FormLayout";
import { scrollToSection } from "@/components/app/AnchorRail";
import { OverlayScrollContext } from "@/components/app/overlay-context";
import { useFormSheet } from "@/components/app/FormOutlet";
import { optionsOf } from "./shared";
import { setDocTitle } from "@/hooks/use-doc-title";

const STEPS = [
  {
    label: "Доступ к серверу",
    key: "access",
    description: "Выберите сеть, из которой доступен Proxmox.",
  },
  {
    label: "Токен и проверка",
    key: "credentials",
    description: "Укажите API-токен. Проверим доступ перед подключением.",
  },
  {
    label: "Размещение",
    key: "placement",
    description: "Уточните название подключения и владельца инфраструктуры.",
  },
];
const MODES = [
  { value: "local", label: "Локальная сеть или VPN" },
  { value: "public", label: "Внешний адрес и порт" },
  { value: "mikrotik", label: "Через устройство MikroTik" },
];
export default function ConnectionForm() {
  const { item, preset = {}, options = {} } = useLoaderData();
  const { id } = useParams(),
    fetcher = useFetcher(),
    { close } = useFormSheet();
  useEffect(() => {
    setDocTitle(id ? "Изменить подключение" : "Новое подключение");
    return () => setDocTitle(item?.name || "Мониторинг Proxmox");
  }, [id, item?.name]);
  const scroller = useContext(OverlayScrollContext);
  const [step, setStep] = useState(0),
    [maxReached, setMaxReached] = useState(0),
    [attempted, setAttempted] = useState(false),
    [headHeight, setHeadHeight] = useState(0);
  const [nameEdited, setNameEdited] = useState(Boolean(item?.name)),
    [checkedPayload, setCheckedPayload] = useState("");
  const [mode, setMode] = useState(
    (item?.endpoints?.[0]?.transport || preset.transport) === "mikrotik"
      ? "mikrotik"
      : "local",
  );
  const [draft, setDraft] = useState({
    name: item?.name || "",
    companyId: item?.companyId || item?.company?.id || "",
    tokenId: item?.tokenId || "",
    tokenSecret: "",
    monitoringEnabled: item?.monitoringEnabled ?? true,
    endpoint: item?.endpoints?.[0] || {
      host: "",
      port: "8006",
      ...preset,
      tlsMode: "system",
      caCert: "",
      fingerprint: "",
    },
  });
  const busy = fetcher.state !== "idle";
  const change = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const endpoint = (key, value) =>
    setDraft((d) => ({ ...d, endpoint: { ...d.endpoint, [key]: value } }));
  const payload = {
    name: draft.name.trim(),
    companyId: draft.companyId,
    tokenId: draft.tokenId.trim(),
    ...(draft.tokenSecret ? { tokenSecret: draft.tokenSecret } : {}),
    monitoringEnabled: draft.monitoringEnabled,
    endpoints: [
      {
        ...draft.endpoint,
        host: draft.endpoint.host.trim(),
        port: Number(draft.endpoint.port),
        transport: mode === "mikrotik" ? "mikrotik" : "direct",
        ...(mode !== "mikrotik" ? { mikrotikRecordId: undefined } : {}),
      },
      ...(item?.endpoints?.slice(1) || []),
    ],
  };
  const signature = JSON.stringify({
    endpoints: payload.endpoints,
    tokenId: payload.tokenId,
    tokenSecret: draft.tokenSecret,
  });
  const verification =
    !busy && checkedPayload === signature && !fetcher.data?.error
      ? fetcher.data?.verification
      : null;
  const errors = {
    host: !draft.endpoint.host.trim() ? "Укажите IP-адрес или DNS-имя" : null,
    port:
      !Number.isInteger(Number(draft.endpoint.port)) ||
      Number(draft.endpoint.port) < 1 ||
      Number(draft.endpoint.port) > 65535
        ? "Порт от 1 до 65535"
        : null,
    router:
      mode === "mikrotik" && !draft.endpoint.mikrotikRecordId
        ? "Выберите устройство MikroTik"
        : null,
    token: !draft.tokenId.trim() ? "Укажите ID API-токена" : null,
    secret: !id && !draft.tokenSecret ? "Укажите секрет токена" : null,
    ca:
      draft.endpoint.tlsMode === "ca" && !draft.endpoint.caCert?.trim()
        ? "Вставьте сертификат CA в формате PEM"
        : null,
    fingerprint:
      draft.endpoint.tlsMode === "fingerprint" &&
      !draft.endpoint.fingerprint?.trim()
        ? "Укажите SHA-256 отпечаток"
        : null,
    name: !draft.name.trim() ? "Укажите название подключения" : null,
    company: !draft.companyId ? "Выберите владельца инфраструктуры" : null,
  };
  const accessValid = !errors.host && !errors.port && !errors.router;
  const credentialsValid =
    !errors.token && !errors.secret && !errors.ca && !errors.fingerprint;
  const go = (index) => {
    setAttempted(false);
    setStep(index);
  };
  const showSection = (index) => {
    if (id) scrollToSection(scroller, sectionAnchorId(STEPS[index].key));
    else setStep(index);
  };
  const verify = () => {
    setAttempted(true);
    if (!accessValid) {
      showSection(0);
      return;
    }
    if (!credentialsValid) return;
    setCheckedPayload(signature);
    fetcher.submit(
      { intent: "verify", ...payload, ...(id ? { connectionId: id } : {}) },
      { method: "post", encType: "application/json" },
    );
  };
  const next = () => {
    setAttempted(true);
    if (step === 0 && !accessValid) return;
    if (step === 1 && (!credentialsValid || !verification)) return;
    if (step === 1 && !nameEdited && verification?.nodeName)
      change("name", verification.nodeName);
    setMaxReached((n) => Math.max(n, step + 1));
    go(step + 1);
  };
  const save = (event) => {
    event.preventDefault();
    setAttempted(true);
    if (!accessValid) {
      showSection(0);
      return;
    }
    if (!credentialsValid || !verification) {
      showSection(1);
      return;
    }
    if (errors.name || errors.company) {
      showSection(2);
      return;
    }
    fetcher.submit(
      { intent: "connection", ...payload },
      { method: "post", encType: "application/json" },
    );
  };
  const error = (key) => (attempted ? errors[key] : null);
  const version =
    typeof verification?.version === "string"
      ? verification.version
      : verification?.version?.version;
  const renderAccess = () => (
    <>
      <Field label="Способ подключения">
        <ChoiceGroup
          ariaLabel="Способ подключения"
          value={mode}
          options={MODES.map((m) => ({
            ...m,
            disabled:
              m.value === "mikrotik" &&
              !options.mikrotik?.length &&
              mode !== "mikrotik",
            hint:
              m.value === "mikrotik" && !options.mikrotik?.length
                ? "Нет доступных устройств MikroTik"
                : undefined,
          }))}
          onChange={setMode}
        />
      </Field>
      {mode === "mikrotik" && (
        <Field label="Устройство MikroTik" required error={error("router")}>
          <Combobox
            ariaLabel="Устройство MikroTik"
            value={draft.endpoint.mikrotikRecordId || null}
            options={optionsOf(options.mikrotik)}
            onChange={(v) => endpoint("mikrotikRecordId", v)}
          />
        </Field>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-4">
        <Field
          label="Адрес сервера"
          htmlFor="proxmox-host"
          required
          error={error("host")}
        >
          <Input
            id="proxmox-host"
            value={draft.endpoint.host}
            onChange={(e) => endpoint("host", e.target.value)}
            placeholder="10.0.50.200"
            aria-invalid={Boolean(error("host"))}
          />
        </Field>
        <Field
          label="Порт"
          htmlFor="proxmox-port"
          required
          error={error("port")}
        >
          <Input
            id="proxmox-port"
            type="number"
            min={1}
            max={65535}
            value={draft.endpoint.port}
            onChange={(e) => endpoint("port", e.target.value)}
            aria-invalid={Boolean(error("port"))}
          />
        </Field>
      </div>
      <Discovery
        key={`${mode}:${draft.endpoint.mikrotikRecordId || ""}:${draft.endpoint.port}`}
        mode={mode}
        router={draft.endpoint.mikrotikRecordId}
        port={draft.endpoint.port}
        onUse={(candidate) => {
          setCheckedPayload("");
          setDraft((d) => ({
            ...d,
            endpoint: {
              ...d.endpoint,
              host: candidate.host,
              port: candidate.port,
            },
          }));
        }}
      />
      <p className="text-sm text-muted-foreground">
        {mode === "local"
          ? "Используется сеть сервера HD, включая подключённый на нём VPN."
          : mode === "public"
            ? "Укажите публичный адрес и порт Proxmox или проброса NAT."
            : "Подключение пройдёт через выбранный маршрутизатор."}
      </p>
    </>
  );
  const renderCredentials = () => (
    <>
      <Alert variant="info" className="mb-5">
        <RiInformationLine />
        <AlertTitle>Настройка прав в Proxmox</AlertTitle>
        <AlertDescription>
          <p>
            Для мониторинга нужны права <code>Sys.Audit</code>,{" "}
            <code>VM.Audit</code> и <code>Datastore.Audit</code>.
          </p>
          <p>
            В Datacenter → Permissions назначьте роль с этими правами на пути{" "}
            <code>/</code> с включённым Propagate. При включённом Privilege
            Separation нужны две отдельные записи:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              User Permission — для пользователя, которому принадлежит токен.
            </li>
            <li>API Token Permission — для самого токена.</li>
          </ul>
          <p>
            Прав только у пользователя или только у токена недостаточно. Для
            управления питанием ВМ дополнительно нужно <code>VM.PowerMgmt</code>
            , для резервного копирования — <code>VM.Backup</code>.
          </p>
        </AlertDescription>
      </Alert>
      <Field
        label="ID API-токена"
        htmlFor="proxmox-token"
        required
        error={error("token")}
      >
        <Input
          id="proxmox-token"
          value={draft.tokenId}
          onChange={(e) => change("tokenId", e.target.value)}
          placeholder="monitoring@pve!hd"
          aria-invalid={Boolean(error("token"))}
        />
      </Field>
      <Field
        label="Секрет токена"
        htmlFor="proxmox-secret"
        required={!id}
        error={error("secret")}
        hint={
          item?.hasToken
            ? "Секрет сохранён. Оставьте поле пустым, чтобы не менять его."
            : undefined
        }
      >
        <Input
          id="proxmox-secret"
          type="password"
          autoComplete="new-password"
          value={draft.tokenSecret}
          onChange={(e) => change("tokenSecret", e.target.value)}
          placeholder="Вставьте секрет API-токена"
          aria-invalid={Boolean(error("secret"))}
        />
      </Field>
      <Field
        label="Проверка сертификата"
        hint={
          draft.endpoint.tlsMode === "insecure"
            ? "Соединение шифруется через HTTPS, но подлинность сервера не проверяется. Используйте только в доверенной сети."
            : undefined
        }
      >
        <Combobox
          ariaLabel="Проверка сертификата"
          value={draft.endpoint.tlsMode}
          onChange={(v) => endpoint("tlsMode", v)}
          options={[
            { value: "system", label: "Доверенный сертификат" },
            { value: "fingerprint", label: "По отпечатку SHA-256" },
            { value: "ca", label: "Свой центр сертификации" },
            { value: "insecure", label: "Без проверки сертификата" },
          ]}
        />
      </Field>
      {draft.endpoint.tlsMode === "ca" && (
        <Field
          label="Сертификат CA (PEM)"
          htmlFor="proxmox-ca"
          required
          error={error("ca")}
        >
          <Textarea
            id="proxmox-ca"
            value={draft.endpoint.caCert || ""}
            onChange={(e) => endpoint("caCert", e.target.value)}
            aria-invalid={Boolean(error("ca"))}
          />
        </Field>
      )}
      {draft.endpoint.tlsMode === "fingerprint" && (
        <Field
          label="Отпечаток SHA-256"
          htmlFor="proxmox-fingerprint"
          required
          error={error("fingerprint")}
        >
          <Input
            id="proxmox-fingerprint"
            value={draft.endpoint.fingerprint || ""}
            onChange={(e) => endpoint("fingerprint", e.target.value)}
            aria-invalid={Boolean(error("fingerprint"))}
          />
        </Field>
      )}
      <div className="mt-5 border-t border-border-soft pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={verify}
        >
          {verification ? <RiCheckLine /> : <RiShieldCheckLine />}
          {busy
            ? "Проверяем…"
            : verification
              ? "Проверить снова"
              : "Проверить подключение"}
        </Button>
        {verification && (
          <div role="status" className="mt-4 text-sm">
            <p className="flex items-center gap-2 text-accent-text">
              <RiCheckLine />
              Сервер доступен{version ? ` · Proxmox VE ${version}` : ""}
            </p>
            {verification.nodeName && (
              <p className="mt-1 text-muted-foreground">
                Локальный узел: {verification.nodeName}
              </p>
            )}
          </div>
        )}
        {attempted &&
          credentialsValid &&
          !verification &&
          !busy &&
          !fetcher.data?.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Проверьте подключение перед продолжением.
            </p>
          )}
        {fetcher.data?.error && (
          <div className="mt-4">
            <AlertMessage variant="danger" message={fetcher.data.message} />
          </div>
        )}
      </div>
    </>
  );
  const renderPlacement = () => (
    <>
      <Field
        label="Название подключения"
        htmlFor="proxmox-name"
        required
        hint="После проверки подставляется имя локального узла Proxmox. Можно изменить."
        error={error("name")}
      >
        <Input
          id="proxmox-name"
          value={draft.name}
          onChange={(e) => {
            setNameEdited(true);
            change("name", e.target.value);
          }}
          aria-invalid={Boolean(error("name"))}
        />
      </Field>
      <Field label="Владелец инфраструктуры" required error={error("company")}>
        <Combobox
          ariaLabel="Владелец инфраструктуры"
          value={draft.companyId || null}
          options={optionsOf(options.companies)}
          onChange={(v) => change("companyId", v)}
        />
      </Field>
      <div className="flex items-start gap-3 border-t border-border-soft pt-5">
        <Switch
          id="proxmox-monitor"
          checked={draft.monitoringEnabled}
          onCheckedChange={(v) => change("monitoringEnabled", v)}
        />
        <label htmlFor="proxmox-monitor">
          <span className="text-sm font-medium">Мониторинг включён</span>
          <p className="mt-1 text-xs text-muted-foreground">
            Состояние, метрики и доступность узлов и ВМ.
          </p>
        </label>
      </div>
      <p className="mt-5 text-sm text-muted-foreground">
        Компании виртуальных машин назначаются отдельно после синхронизации.
        Владелец сервера не становится арендатором ВМ.
      </p>
    </>
  );
  const bodies = [renderAccess, renderCredentials, renderPlacement];
  return (
    <form onSubmit={save} noValidate>
      {id ? (
        <FormHeader title="Изменить подключение" onHeight={setHeadHeight} />
      ) : (
        <>
          <h1 className="my-0 mb-5 pr-10 text-2xl font-semibold tracking-tight">
            Новое подключение
          </h1>
          <WizardStepper
            steps={STEPS}
            current={step}
            maxReached={maxReached}
            onStepClick={go}
          />
        </>
      )}
      {id ? (
        <div className="max-md:[&_nav]:hidden">
          <FormSections
            headHeight={headHeight}
            sections={STEPS.map((s, i) => ({
              key: s.key,
              title: s.label,
              desc: s.description,
              body: bodies[i](),
            }))}
          />
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-7 md:flex-row">
          <div className="min-w-0 flex-1">
            <h2 className="mb-1 text-base font-semibold">
              {STEPS[step].label}
            </h2>
            <p className="mb-5 text-sm text-muted-foreground">
              {STEPS[step].description}
            </p>
            {bodies[step]()}
          </div>
          <aside className="w-full self-start rounded-xl bg-accent/50 p-5 md:w-64 md:shrink-0">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-faint">
              Подключение
            </h3>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="mb-1 text-xs text-muted-foreground">
                  Путь доступа
                </dt>
                <dd>{MODES.find((m) => m.value === mode)?.label}</dd>
              </div>
              <div>
                <dt className="mb-1 text-xs text-muted-foreground">Сервер</dt>
                <dd className="break-all">
                  {draft.endpoint.host
                    ? `${draft.endpoint.host}:${draft.endpoint.port}`
                    : "Адрес не указан"}
                </dd>
              </div>
              {verification?.nodeName && (
                <div>
                  <dt className="mb-1 text-xs text-muted-foreground">
                    Обнаружен узел
                  </dt>
                  <dd>{verification.nodeName}</dd>
                </div>
              )}
              {step === 2 && draft.companyId && (
                <div>
                  <dt className="mb-1 text-xs text-muted-foreground">
                    Владелец
                  </dt>
                  <dd>
                    {
                      optionsOf(options.companies).find(
                        (o) => o.value === draft.companyId,
                      )?.label
                    }
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
              {verification
                ? "Параметры проверены. Ресурсы появятся после подключения."
                : "Сервер будет добавлен после проверки доступа."}
            </p>
          </aside>
        </div>
      )}
      {!id && step !== 1 && fetcher.data?.error && (
        <div className="mt-4">
          <AlertMessage variant="danger" message={fetcher.data.message} />
        </div>
      )}
      <FormActions>
        <Button type="button" variant="ghost" onClick={close} disabled={busy}>
          Отмена
        </Button>
        <div className="ml-auto flex items-center gap-2.5">
          {!id && step > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => go(step - 1)}
            >
              <RiArrowLeftLine />
              Назад
            </Button>
          )}
          {!id && step < 2 ? (
            <Button type="button" disabled={busy} onClick={next}>
              Далее
              <RiArrowRightLine />
            </Button>
          ) : (
            <Button type="submit" disabled={busy}>
              <RiCheckLine />
              {busy ? "Сохранение…" : "Сохранить"}
            </Button>
          )}
        </div>
      </FormActions>
    </form>
  );
}
