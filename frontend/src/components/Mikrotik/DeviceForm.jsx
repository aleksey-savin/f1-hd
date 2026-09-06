import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useParams,
  useRevalidator,
  useSearchParams,
} from "react-router";

import {
  RiArchive2Line,
  RiCheckLine,
  RiExternalLinkLine,
  RiEyeLine,
  RiEyeOffLine,
  RiRefreshLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";
import AlertMessage from "@/components/app/AlertMessage";
import { SubLabel } from "@/components/app/Panel";
import { useFormSheet } from "@/components/app/FormOutlet";
import useToastStore from "@/store/toast-store";

import Combobox from "@/components/app/Combobox";
import SetupHelp, { genPassword, parseKnock } from "./SetupHelp";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

const EMPTY_FORM = {
  companyId: "",
  label: "",
  host: "",
  port: "8729",
  user: "",
  password: "",
  sshPort: "22",
  knockSequence: "",
  jumpRecordId: "",
};

// Форма устройства мониторинга (создание и правка — одна). Сабмит — живая
// проверка подключения (verify-on-save); после успешной проверки создание
// показывает шаг «Устройство подключено» с блоком «Инвентарь»: карточка с тем
// же серийным номером предлагается к связи, отсутствующая — к созданию.
// Рендерится вложенным маршрутом (add / update/:recordId) в шторке (app/FormOutlet).
const DeviceForm = () => {
  const { recordId } = useParams();
  const revalidator = useRevalidator();
  const { close } = useFormSheet();
  const showToast = useToastStore((state) => state.showToast);

  const rows = useMikrotikDeviceFilterStore((state) => state.originalList);
  const fetchRows = useMikrotikDeviceFilterStore((state) => state.fetch);
  const fetchRecord = useMikrotikDeviceFilterStore(
    (state) => state.fetchRecord,
  );
  const createStandalone = useMikrotikDeviceFilterStore(
    (state) => state.createStandalone,
  );
  const saveRecordParameters = useMikrotikDeviceFilterStore(
    (state) => state.saveRecordParameters,
  );
  const linkInventory = useMikrotikDeviceFilterStore(
    (state) => state.linkInventory,
  );
  const createInventoryCard = useMikrotikDeviceFilterStore(
    (state) => state.createInventoryCard,
  );

  const isEdit = Boolean(recordId);

  // Подключение существующей карточки инвентаря: «Подключить к мониторингу» на
  // карточке устройства открывает эту же форму с ?clientDeviceId=. Компания и
  // адрес берутся из карточки, а связь ставится сразу после успешной проверки —
  // шаг «нашли карточку по серийному номеру» на этом пути не нужен.
  const [searchParams] = useSearchParams();
  const targetDeviceId = isEdit ? null : searchParams.get("clientDeviceId");
  const [targetDevice, setTargetDevice] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  // Связанная с инвентарём запись: идентичность даёт карточка — поля
  // «Компания»/«Название» в форме не показываются.
  const [isLinked, setIsLinked] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [jumpEnabled, setJumpEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Шаг после проверки: считанные данные + блок «Инвентарь».
  const [step, setStep] = useState("form");
  const [result, setResult] = useState(null);
  const [linkState, setLinkState] = useState(null); // null | linked | created
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState(null);

  useEffect(() => {
    document.title = isEdit ? "Изменить устройство" : "Новое устройство";
  }, [isEdit]);

  // Компании для селекта.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/companies`,
          {
            signal: controller.signal,
          },
        );
        if (!response.ok) return;
        const data = await response.json();
        setCompanies(Array.isArray(data) ? data : []);
      } catch {
        // keep empty
      }
    })();
    return () => controller.abort();
  }, []);

  // Кандидаты в «Мост» берутся из списка управления — при прямом заходе по
  // адресу формы он может быть ещё не загружен.
  useEffect(() => {
    if (!Array.isArray(rows) || rows.length === 0) fetchRows();
  }, []);

  // Префилл правки. Пароль и knock — секреты, API их не возвращает.
  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    (async () => {
      const data = await fetchRecord(recordId);
      if (cancelled || !data) return;
      const creds = data.record?.credentials;
      setIsLinked(Boolean(data.clientDeviceId));
      setForm((prev) => ({
        ...prev,
        // У связанной записи компанию даёт карточка — в сабмит не уходит, но
        // фильтрует кандидатов в «Мост».
        companyId:
          data.record?.companyId?._id ||
          data.record?.companyId ||
          (data.company?.id ? String(data.company.id) : ""),
        label: data.record?.label || "",
        host: creds?.host ?? "",
        port: creds?.port != null ? String(creds.port) : prev.port,
        user: creds?.user ?? "",
        sshPort: creds?.sshPort != null ? String(creds.sshPort) : prev.sshPort,
        jumpRecordId: data.record?.jumpRecordId || "",
      }));
      setJumpEnabled(Boolean(data.record?.jumpRecordId));
    })();
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  // Префилл из карточки инвентаря: компания (менять её нельзя — запись
  // принадлежит той же компании), название и адрес, если он в карточке указан.
  useEffect(() => {
    if (!targetDeviceId) return;
    let cancelled = false;
    (async () => {
      const base = import.meta.env.VITE_API_ADDRESS;
      try {
        const response = await fetch(
          base + "/api/inventory/client-devices/" + targetDeviceId,
        );
        if (!response.ok) return;
        const device = await response.json();
        if (cancelled) return;
        const model = device.deviceModelId;
        const title =
          [model?.vendorId?.name, model?.name].filter(Boolean).join(" ") ||
          model?.deviceTypeId?.name ||
          device.deviceTypeId?.name ||
          "Устройство";
        setTargetDevice({
          _id: device._id,
          title,
          inventoryNumber: device.inventoryNumber || null,
          companyName:
            device.companyId?.alias || device.companyId?.fullTitle || null,
        });
        setForm((prev) => ({
          ...prev,
          companyId: device.companyId?._id || prev.companyId,
          label: title,
          host: prev.host || device.ipAddress || "",
        }));
      } catch {
        // Не получилось прочитать карточку — форма остаётся обычной.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetDeviceId]);

  const changeHandler = (event) =>
    setForm((prev) => ({
      ...prev,
      [event.target.name]: event.target.value,
    }));

  // Выключение свитча = прямое подключение: выбранный мост сбрасывается.
  const toggleJump = (checked) => {
    setJumpEnabled(checked);
    if (!checked) setForm((prev) => ({ ...prev, jumpRecordId: "" }));
  };

  const companyOptions = companies.map((company) => ({
    value: company._id,
    label: company.alias || company.fullTitle,
  }));

  // Кандидаты в «Мост»: настроенные записи ВЫБРАННОЙ компании (кроме
  // редактируемой и записей, которые сами подключены через мост — один
  // уровень). Компания не выбрана → список пуст.
  const jumpOptions = useMemo(() => {
    if (!form.companyId) return [];
    return (Array.isArray(rows) ? rows : [])
      .filter(
        (row) =>
          row.recordId &&
          !row.jump &&
          row.recordId !== (recordId || null) &&
          String(row.company?.id) === form.companyId,
      )
      .map((row) => ({
        value: row.recordId,
        label: row.host ? `${row.displayName} (${row.host})` : row.displayName,
      }));
  }, [rows, form.companyId, recordId]);

  const finish = () => {
    fetchRows();
    revalidator.revalidate();
    // Пришли с карточки устройства — туда и возвращаемся: подключение было
    // шагом её задачи, а не заходом в раздел мониторинга. Шторка сперва
    // уезжает, переход — после (useFormSheet).
    if (targetDeviceId) {
      close(`/inventory/client-devices/${targetDeviceId}`, { replace: true });
      return;
    }
    close("..", { replace: true });
  };

  const submitHandler = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const body = {
        host: form.host,
        port: Number(form.port),
        user: form.user,
        password: form.password,
        // Через транзит knock не используется — поле скрыто, шлём пустой список
        // (бэкенд валидирует комбинацию и сбрасывает сохранённый knock).
        knockSequence: form.jumpRecordId ? [] : parseKnock(form.knockSequence),
        sshPort: Number(form.sshPort),
        jumpRecordId: form.jumpRecordId || null,
        ...(isLinked ? {} : { companyId: form.companyId, label: form.label }),
      };
      const response = isEdit
        ? await saveRecordParameters(recordId, body)
        : await createStandalone(body);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message || "Не удалось сохранить устройство");
        return;
      }

      // Пришли с карточки устройства — связываем сразу: решать, какую карточку
      // взять, не нужно, её выбрал пользователь ещё до формы.
      if (targetDeviceId && data.record?._id) {
        setResult({ record: data.record, inventory: null });
        setStep("done");
        const linkResponse = await linkInventory(
          data.record._id,
          targetDeviceId,
        );
        if (linkResponse.ok) {
          setLinkState("linked");
        } else {
          const linkData = await linkResponse.json().catch(() => ({}));
          setLinkError(
            linkData.message ||
              "Устройство подключено, но связать карточку не удалось",
          );
        }
        return;
      }

      // Блок «Инвентарь» показывается, когда есть что решать: нашёлся кандидат
      // или карточку можно создать (есть серийник). Иначе — сразу закрываемся.
      const inventory = data.inventory;
      const canOfferLink =
        inventory &&
        data.record?.serialNumber &&
        (inventory.candidate || inventory.canCreateCard);
      if (canOfferLink || !isEdit) {
        setResult({ record: data.record, inventory: inventory || null });
        setStep("done");
        return;
      }

      showToast("success", data.message || "Параметры сохранены и проверены");
      finish();
    } finally {
      setIsSaving(false);
    }
  };

  const handleLink = async () => {
    if (!result?.record?._id || !result.inventory?.candidate) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const response = await linkInventory(
        result.record._id,
        result.inventory.candidate.clientDeviceId,
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLinkError(data.message || "Не удалось связать карточку");
        return;
      }
      setLinkState("linked");
    } finally {
      setLinkBusy(false);
    }
  };

  const handleCreateCard = async () => {
    if (!result?.record?._id) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const response = await createInventoryCard(result.record._id);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLinkError(data.message || "Не удалось создать карточку");
        return;
      }
      setLinkState("created");
    } finally {
      setLinkBusy(false);
    }
  };

  // ── Шаг после проверки ──
  if (step === "done" && result) {
    const record = result.record || {};
    const inventory = result.inventory;
    const candidate = inventory?.candidate;
    // linkState — уже связано (в том числе автоматически, при заходе с
    // карточки устройства): блок показывает результат, а не выбор.
    const showInventory =
      linkState ||
      linkError ||
      (inventory &&
        record.serialNumber &&
        (candidate || inventory.canCreateCard));

    return (
      <div>
        <div className="mx-auto mt-2 grid size-12 place-items-center rounded-full bg-primary/15 text-accent-text">
          <RiCheckLine size={24} aria-hidden />
        </div>
        <div className="mt-2.5 text-center text-lg font-semibold">
          {isEdit ? "Параметры сохранены" : "Устройство подключено"}
        </div>
        <div className="mt-0.5 text-center text-sm text-muted-foreground">
          {record.name || "Устройство"} отвечает по API-SSL · мониторинг
          включён, проверка каждые 5 минут
        </div>

        <div className="mt-4 rounded-xl border border-border-soft bg-accent/40 px-4 py-1">
          {[
            ["Имя (identity)", record.name, true],
            ["Плата", record.boardName],
            ["RouterOS", record.currentFirmware, true],
            ["Серийный номер", record.serialNumber, true],
            ["Адресов", (record.addresses || []).length || null],
          ].map(([label, value, mono]) => (
            <div
              key={label}
              className="flex items-baseline gap-3 border-t border-border py-2 text-sm first:border-t-0"
            >
              <span className="w-36 flex-none text-muted-foreground">
                {label}
              </span>
              <span className={mono ? "font-mono" : undefined}>
                {value ?? <span className="text-faint">—</span>}
              </span>
            </div>
          ))}
        </div>

        {showInventory && (
          <>
            <SubLabel className="mt-5">Инвентарь</SubLabel>
            {linkState ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-border px-4 py-3 text-sm">
                <RiCheckLine
                  aria-hidden
                  className="flex-none text-accent-text"
                />
                <span>
                  {linkState === "created"
                    ? "Карточка создана и связана."
                    : "Карточка связана."}{" "}
                  Живой статус устройства появится в «Окружении» и на карточке
                  инвентаря.
                </span>
              </div>
            ) : !inventory ? (
              // Пришли с карточки, но связать не удалось — запись создана,
              // связь можно поставить с карточки повторно.
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
                {linkError}
              </div>
            ) : (
              <div className="rounded-xl border border-border px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 flex-none place-items-center rounded-lg bg-accent text-muted-foreground">
                    <RiArchive2Line size={18} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    {candidate ? (
                      <>
                        <div className="text-sm font-semibold">
                          Найдена карточка с этим серийным номером
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {[
                            [candidate.vendorName, candidate.modelName]
                              .filter(Boolean)
                              .join(" ") || candidate.hostname,
                            candidate.inventoryNumber
                              ? `инв. №${candidate.inventoryNumber}`
                              : null,
                            candidate.company?.name,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Карточки с таким серийным номером в инвентаре нет —
                        можно создать её из считанных данных.
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {candidate ? (
                    <Button size="sm" disabled={linkBusy} onClick={handleLink}>
                      {linkBusy ? "Связываем…" : "Связать карточку"}
                    </Button>
                  ) : (
                    inventory.canCreateCard && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={linkBusy}
                        onClick={handleCreateCard}
                      >
                        {linkBusy ? "Создаём…" : "Создать карточку"}
                      </Button>
                    )
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={linkBusy}
                    onClick={finish}
                  >
                    Пропустить
                  </Button>
                  {linkError && (
                    <span className="text-sm text-destructive">
                      {linkError}
                    </span>
                  )}
                </div>
                <div className="mt-2 text-xs text-faint">
                  Связь включает живой статус устройства в «Окружении»,
                  «Технике» и на карточке инвентаря.
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-border-soft pt-4">
          {linkState && result.record?._id && (
            <Button asChild variant="ghost">
              <Link to={`/devices/mikrotik/records/${result.record._id}`}>
                Открыть устройство <RiExternalLinkLine size={13} />
              </Link>
            </Button>
          )}
          <Button onClick={finish}>Готово</Button>
        </div>
      </div>
    );
  }

  // ── Форма ──
  return (
    <form onSubmit={submitHandler}>
      <div className="mb-4 text-lg font-semibold">
        {isEdit ? "Изменить устройство" : "Новое устройство"}
      </div>

      {error && <AlertMessage variant="danger" message={error} />}

      {/* Подключение карточки из инвентаря: с чем свяжемся — видно до сабмита */}
      {targetDevice && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-accent px-3.5 py-3">
          <span className="grid size-10 flex-none place-items-center rounded-lg bg-card text-muted-foreground">
            <RiArchive2Line size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              Подключаем карточку из инвентаря
            </div>
            <div className="truncate text-sm text-muted-foreground">
              {[
                targetDevice.title,
                targetDevice.inventoryNumber
                  ? `инв. №${targetDevice.inventoryNumber}`
                  : null,
                targetDevice.companyName,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>
      )}

      {targetDevice ? (
        // Компания и название — из карточки: запись принадлежит той же
        // компании, а имя устройства уже названо в инвентаре.
        <div className="mb-3 text-sm text-muted-foreground">
          Компания и название берутся из карточки устройства.
        </div>
      ) : !isLinked ? (
        <div className="grid gap-x-3 md:grid-cols-2">
          <Field label="Компания" htmlFor="mikrotik-company" required>
            <Combobox
              id="mikrotik-company"
              options={companyOptions}
              value={form.companyId || null}
              onChange={(value) =>
                // Смена компании сбрасывает мост: кандидаты фильтруются по
                // компании, чужой мост не должен уехать в сабмит.
                setForm((prev) => ({
                  ...prev,
                  companyId: value || "",
                  jumpRecordId: "",
                }))
              }
              placeholder="Выберите компанию"
              clearable
              clearLabel="Не выбрана"
            />
          </Field>
          <Field
            label="Название"
            htmlFor="mikrotik-label"
            hint="Если пусто — возьмём системное имя устройства."
          >
            <Input
              id="mikrotik-label"
              name="label"
              value={form.label}
              onChange={changeHandler}
              placeholder="например, gw-branch-02"
            />
          </Field>
        </div>
      ) : (
        <div className="mb-3 text-sm text-muted-foreground">
          Компания и название управляются связанной карточкой инвентаря.
        </div>
      )}

      <SubLabel className="mt-2">Подключение</SubLabel>
      <div className="grid gap-x-3 md:grid-cols-2">
        <Field label="Хост" htmlFor="mikrotik-host" required>
          <Input
            id="mikrotik-host"
            name="host"
            value={form.host}
            onChange={changeHandler}
            placeholder="IP или домен"
            className="font-mono"
            autoFocus={!isEdit}
          />
        </Field>
        <Field label="Порт API-SSL" htmlFor="mikrotik-port" required>
          <Input
            id="mikrotik-port"
            name="port"
            type="number"
            value={form.port}
            onChange={changeHandler}
            className="font-mono"
          />
        </Field>
        <Field
          label="Пользователь"
          htmlFor="mikrotik-user"
          required
          hint="Выделенный аккаунт, не из группы full."
        >
          <Input
            id="mikrotik-user"
            name="user"
            value={form.user}
            onChange={changeHandler}
            placeholder="hd-monitor"
          />
        </Field>
        <Field
          label="Пароль"
          htmlFor="mikrotik-password"
          required
          hint={
            isEdit
              ? "Нужен для проверки подключения — сохранённый не показывается."
              : undefined
          }
        >
          <div className="flex gap-1.5">
            <Input
              id="mikrotik-password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={changeHandler}
              className="min-w-0 flex-1 font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              tabIndex={-1}
              title="Сгенерировать пароль"
              aria-label="Сгенерировать пароль"
              onClick={() => {
                setForm((prev) => ({ ...prev, password: genPassword() }));
                setShowPassword(true);
              }}
            >
              <RiRefreshLine />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              tabIndex={-1}
              title={showPassword ? "Скрыть пароль" : "Показать пароль"}
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? <RiEyeOffLine /> : <RiEyeLine />}
            </Button>
          </div>
        </Field>
        <Field
          label="SSH-порт"
          htmlFor="mikrotik-ssh-port"
          hint="Для экспорта конфигураций."
        >
          <Input
            id="mikrotik-ssh-port"
            name="sshPort"
            type="number"
            value={form.sshPort}
            onChange={changeHandler}
            className="font-mono"
          />
        </Field>
        {!form.jumpRecordId && (
          <Field
            label="Port knocking"
            htmlFor="mikrotik-knock"
            hint="Порты через пробел — постучимся перед подключением. Заполняются из инструкции ниже."
          >
            <Input
              id="mikrotik-knock"
              name="knockSequence"
              value={form.knockSequence}
              onChange={changeHandler}
              placeholder="например, 22000 22111 22222"
              className="font-mono"
            />
          </Field>
        )}
      </div>

      <SwitchField
        id="mikrotik-jump"
        checked={jumpEnabled}
        onCheckedChange={toggleJump}
        label="Подключение через устройство"
        hint="Хост недоступен напрямую — подключимся SSH-туннелем через другой Mikrotik этой компании. Port knocking через туннель не используется."
      />
      {jumpEnabled && (
        <Field label="Мост" htmlFor="mikrotik-jump-record">
          <Combobox
            id="mikrotik-jump-record"
            options={jumpOptions}
            value={form.jumpRecordId || null}
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                jumpRecordId: value || "",
              }))
            }
            placeholder={
              form.companyId || isLinked
                ? jumpOptions.length
                  ? "Выберите устройство"
                  : "Нет доступных устройств в компании"
                : "Сначала выберите компанию"
            }
            clearable
            clearLabel="Без транзита"
          />
        </Field>
      )}

      <SetupHelp
        host={form.host}
        user={form.user}
        password={form.password}
        apiPort={form.port}
        sshPort={form.sshPort}
        knockSequence={form.knockSequence}
        onChange={changeHandler}
        jumpSelected={Boolean(form.jumpRecordId)}
      />

      <div className="mt-5 flex items-center gap-2 border-t border-border-soft pt-4">
        <div className="min-w-0 flex-1 text-xs text-faint">
          Перед сохранением проверим подключение к устройству.
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => close("..")}
        >
          Отмена
        </Button>
        <Button
          type="submit"
          disabled={
            isSaving ||
            !form.host ||
            !form.port ||
            !form.user ||
            !form.password ||
            (!isLinked && !form.companyId)
          }
        >
          {isSaving ? "Проверяем подключение…" : "Сохранить"}
        </Button>
      </div>
    </form>
  );
};

export default DeviceForm;
