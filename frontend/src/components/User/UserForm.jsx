import { useContext, useEffect, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiDiceLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";
import Segmented from "@/components/app/Segmented";
import WizardStepper from "@/components/app/WizardStepper";
import AlertMessage from "@/components/app/AlertMessage";
import { cn } from "@/lib/utils";

import Select from "../../UI/Select";
import useOffcanvasStore from "../../store/offcanvas";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getInitialPrefsData } from "../../util/prefs";

import {
  ACCOUNT_KINDS,
  ALL_PERMISSION_KEYS,
  DASHBOARD_MODULE,
  NOTIFY_EVENTS,
  PERMISSION_MODULES,
  kindOfUser,
  kindToFlags,
} from "./permissions-catalog";
import FormSummary from "./FormSummary";

// Форма пользователя: создание — визард со сводкой, правка — плоские секции
// (конвенция ux-ui-guide). Набор шагов зависит от типа аккаунта: клиенту не
// нужны права и категории, служебному — почти ничего. Тип аккаунта — один
// сегмент вместо трёх независимых флагов модели (isEndUser/isServiceAccount/
// isCloudTelephony); обратно в флаги собирается при сабмите.
const emptyPermissions = () =>
  Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, false]));

const emptyDashboard = () =>
  Object.fromEntries(
    [DASHBOARD_MODULE.master, ...DASHBOARD_MODULE.caps.map((c) => c.key)].map(
      (key) => [key, false],
    ),
  );

const emptyNotify = () => ({
  byTelegram: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, true])),
  byEmail: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, true])),
});

const randomPassword = () =>
  `${Math.random().toString(36).slice(-10)}${Math.random().toString(36).slice(-4)}`;

const UserForm = () => {
  const { user, companiesList = [], categoriesList = [] } = useLoaderData() || {};
  const isEdit = !!user?._id;

  const authedUser = useContext(AuthedUserContext);
  const canEditFinances = Boolean(
    authedUser.isAdmin || authedUser.permissions?.canSeeGlobalFinancialReport,
  );
  // Глобальная интеграция включена — ключ правят только у клиентов (как в легаси)
  const prefsGetScreenActive = Boolean(getInitialPrefsData()?.getScreen?.isActive);

  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

  const [kind, setKind] = useState(kindOfUser(user));
  const [form, setForm] = useState({
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    email: user?.email || "",
    phone: user?.phone || "",
    position: user?.position || "",
    password: "",
    sendPassword: false,
    isActive: user?.isActive ?? true,
    workStatusEnabled: user ? !user.hideWorkStatus : true,
    isCloudTelephony: !!user?.isCloudTelephony,
    isAdmin: !!user?.isAdmin,
    company: companiesList.find((c) => c._id === user?.company?._id) || null,
    subdivision: null,
    categories: (user?.categories || [])
      .map((category) => categoriesList.find((item) => item._id === category._id))
      .filter(Boolean),
    responsibleForCompanies: (user?.responsibleForCompanies || [])
      .map((item) => companiesList.find((c) => c._id === String(item.id)))
      .filter(Boolean),
    permissions: { ...emptyPermissions(), ...(user?.permissions || {}) },
    dashboard: { ...emptyDashboard(), ...(user?.dashboard || {}) },
    notify: user?.notify
      ? {
          byTelegram: { ...emptyNotify().byTelegram, ...user.notify.byTelegram },
          byEmail: { ...emptyNotify().byEmail, ...user.notify.byEmail },
        }
      : emptyNotify(),
    finances: {
      salary: user?.finances?.salary ?? "",
      overtimeHourlyRate: user?.finances?.overtimeHourlyRate ?? "",
    },
    getScreenApi: user?.getScreen?.api || "",
  });
  // notify правит админ, но это личные настройки пользователя: шлём объект
  // только если его реально трогали, иначе сохранение затрёт чужой выбор.
  const [notifyDirty, setNotifyDirty] = useState(false);

  const setField = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  const subdivisions = form.company?.subdivisions || [];

  // Подтягиваем сохранённое подразделение, когда список компаний уже известен
  useEffect(() => {
    if (!user?.subdivision) return;
    const id = String(user.subdivision?._id || user.subdivision);
    const found = subdivisions.find((s) => String(s._id) === id);
    if (found) setForm((prev) => ({ ...prev, subdivision: found }));
  }, [form.company]);

  const canEditGetScreen = !prefsGetScreenActive || kind === "client";
  const isService = kind === "service";
  const isStaff = kind === "staff";

  /* ---------- шаги ---------- */
  const stepKeys = [
    "person",
    "org",
    ...(isStaff ? ["rights"] : []),
    ...(isService ? [] : ["extra"]),
  ];
  const titles = {
    person: "Основное",
    org: "Организация",
    rights: "Права и доступ",
    extra: "Дополнительно",
  };
  const STEPS = stepKeys.map((key) => ({
    label: key === "rights" ? "Права" : titles[key],
  }));
  const LAST = STEPS.length - 1;

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(isEdit ? 99 : 0);
  const [attempted, setAttempted] = useState(false);

  // Смена типа аккаунта может укоротить набор шагов
  useEffect(() => {
    setStep((current) => Math.min(current, stepKeys.length - 1));
  }, [kind]);

  const stepError = (key) => {
    if (key === "person") {
      if (!form.firstName.trim())
        return isService ? "Укажите наименование" : "Укажите имя";
      if (!isService && !form.lastName.trim()) return "Укажите фамилию";
      if (!form.email.trim()) return "Укажите email";
      if (!isEdit && !isService && !form.password.trim()) return "Задайте пароль";
      return null;
    }
    if (key === "org" && !form.company) return "Выберите компанию";
    return null;
  };

  const handleNext = () => {
    if (stepError(stepKeys[step])) {
      setAttempted(true);
      return;
    }
    const next = Math.min(step + 1, LAST);
    setAttempted(false);
    setStep(next);
    setMaxReached((prev) => Math.max(prev, next));
  };
  const handleBack = () => {
    setAttempted(false);
    setStep((current) => Math.max(0, current - 1));
  };
  const handleStepClick = (index) => {
    if (isEdit || index <= maxReached) {
      setAttempted(false);
      setStep(index);
    }
  };

  const handleClose = () => {
    offcanvas.setClose();
    navigate(-1);
  };

  const saving = fetcher.state !== "idle";

  const handleSubmit = () => {
    const badStep = stepKeys.findIndex((key) => stepError(key));
    if (badStep !== -1) {
      setStep(badStep);
      setAttempted(true);
      return;
    }

    const payload = {
      firstName: form.firstName.trim(),
      lastName: isService ? "" : form.lastName.trim(),
      email: form.email.trim(),
      phone: isService ? "" : form.phone,
      position: isService ? "" : form.position,
      ...kindToFlags(kind, { isCloudTelephony: form.isCloudTelephony }),
      isAdmin: isStaff ? form.isAdmin : false,
      isActive: form.isActive,
      hideWorkStatus: !form.workStatusEnabled,
      company: form.company?._id || null,
      subdivision: form.subdivision?._id || null,
      categories: isStaff ? form.categories.map((c) => c._id) : [],
      responsibleForCompanies: isStaff
        ? form.responsibleForCompanies.map((c) => ({ id: c._id, alias: c.alias }))
        : [],
      permissions: isStaff ? form.permissions : emptyPermissions(),
      dashboard: isStaff ? form.dashboard : emptyDashboard(),
    };

    if (!isEdit && !isService) {
      payload.password = form.password;
      payload.sendPassword = form.sendPassword;
    }
    if (canEditFinances && isStaff) {
      payload.finances = {
        salary: form.finances.salary === "" ? null : Number(form.finances.salary),
        overtimeHourlyRate:
          form.finances.overtimeHourlyRate === ""
            ? null
            : Number(form.finances.overtimeHourlyRate),
      };
    }
    if (canEditGetScreen) payload.getScreenApi = form.getScreenApi;
    if (notifyDirty && !isService) payload.notify = form.notify;

    fetcher.submit(payload, { method: "post", encType: "application/json" });
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      offcanvas.setClose();
      const id = fetcher.data.userId;
      navigate(id ? `/users/${id}` : "..", { replace: true });
    }
  }, [fetcher.state, fetcher.data]);

  /* ---------- переключатели ---------- */
  const togglePerm = (key) =>
    setForm((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] },
    }));
  const toggleDash = (key) =>
    setForm((prev) => ({
      ...prev,
      dashboard: { ...prev.dashboard, [key]: !prev.dashboard[key] },
    }));
  const toggleNotify = (channel, key) => {
    setNotifyDirty(true);
    setForm((prev) => ({
      ...prev,
      notify: {
        ...prev.notify,
        [channel]: { ...prev.notify[channel], [key]: !prev.notify[channel][key] },
      },
    }));
  };

  const moduleBlock = (module, values, toggle) => {
    const master = module.master;
    const off = master ? !values[master] : false;
    const granted = module.caps.filter((cap) => values[cap.key]).length;

    return (
      <div
        key={module.key}
        className={cn(
          "tw:mb-3 tw:rounded-xl tw:border tw:border-border tw:p-4",
          off && "tw:opacity-60",
        )}
      >
        <div className="tw:flex tw:items-center tw:gap-2">
          <span className="tw:text-sm tw:font-semibold">{module.label}</span>
          <span className="tw:text-xs tw:text-faint tw:tabular-nums">
            {off ? "выключен" : `${granted} из ${module.caps.length}`}
          </span>
          {master && (
            <span className="tw:ms-auto">
              <SwitchField
                id={`master-${module.key}`}
                checked={!!values[master]}
                onCheckedChange={() => toggle(master)}
                label="Модуль"
                className="tw:py-0"
              />
            </span>
          )}
        </div>
        {!off &&
          module.caps.map((cap) => (
            <div key={cap.key}>
              <SwitchField
                id={`perm-${cap.key}`}
                checked={!!values[cap.key]}
                onCheckedChange={() => toggle(cap.key)}
                label={cap.label}
                className="tw:py-2"
              />
              {cap.key === "canPerformTickets" && values[cap.key] && (
                <div className="tw:mb-2 tw:rounded-xl tw:border tw:border-border tw:bg-accent tw:p-3">
                  <Field label="Категории заявок" htmlFor="u-categories">
                    <Select
                      id="u-categories"
                      placeholder="Выберите категории"
                      isMulti
                      isClearable
                      isSearchable
                      closeMenuOnSelect={false}
                      value={form.categories}
                      options={categoriesList}
                      getOptionLabel={(option) => option.title}
                      getOptionValue={(option) => option._id}
                      onChange={(value) => setField("categories", value || [])}
                    />
                  </Field>
                  <div className="tw:flex tw:gap-4 tw:text-sm tw:font-semibold">
                    <button
                      type="button"
                      className="tw:cursor-pointer tw:appearance-none tw:border-0 tw:bg-transparent tw:p-0 tw:text-accent-text"
                      onClick={() => setField("categories", categoriesList)}
                    >
                      Добавить все
                    </button>
                    <button
                      type="button"
                      className="tw:cursor-pointer tw:appearance-none tw:border-0 tw:bg-transparent tw:p-0 tw:text-accent-text"
                      onClick={() => setField("categories", [])}
                    >
                      Очистить
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
      </div>
    );
  };

  /* ---------- тела шагов ---------- */
  const personStep = (
    <>
      <Field label="Тип аккаунта" hint="От типа зависят доступные разделы формы.">
        <Segmented
          options={ACCOUNT_KINDS}
          value={kind}
          onChange={setKind}
          ariaLabel="Тип аккаунта"
        />
      </Field>

      {isService ? (
        <Field label="Наименование" required htmlFor="u-firstName">
          <Input
            id="u-firstName"
            value={form.firstName}
            onChange={(event) => setField("firstName", event.target.value)}
          />
        </Field>
      ) : (
        <div className="tw:grid tw:gap-3 tw:md:grid-cols-2">
          <Field label="Фамилия" required htmlFor="u-lastName">
            <Input
              id="u-lastName"
              value={form.lastName}
              onChange={(event) => setField("lastName", event.target.value)}
            />
          </Field>
          <Field label="Имя" required htmlFor="u-firstName">
            <Input
              id="u-firstName"
              value={form.firstName}
              onChange={(event) => setField("firstName", event.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="tw:grid tw:gap-3 tw:md:grid-cols-2">
        <Field label="Email" required htmlFor="u-email">
          <Input
            id="u-email"
            type="email"
            value={form.email}
            onChange={(event) => setField("email", event.target.value)}
          />
        </Field>
        {!isService && (
          <Field label="Телефон" htmlFor="u-phone">
            <Input
              id="u-phone"
              value={form.phone}
              onChange={(event) => setField("phone", event.target.value)}
              placeholder="+7 (___) ___-__-__"
            />
          </Field>
        )}
      </div>

      {!isService && (
        <Field label="Должность" htmlFor="u-position">
          <Input
            id="u-position"
            value={form.position}
            onChange={(event) => setField("position", event.target.value)}
          />
        </Field>
      )}

      {!isEdit && !isService && (
        <>
          <Field label="Пароль" required htmlFor="u-password">
            <div className="tw:flex tw:gap-2">
              <Input
                id="u-password"
                value={form.password}
                onChange={(event) => setField("password", event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setField("password", randomPassword())}
              >
                <RiDiceLine /> Сгенерировать
              </Button>
            </div>
          </Field>
          <SwitchField
            id="u-sendPassword"
            checked={form.sendPassword}
            onCheckedChange={(value) => setField("sendPassword", value)}
            label="Отправить учётные данные на email"
            hint="Письмо с логином и паролем уйдёт сразу после создания."
          />
        </>
      )}

      {isService && (
        <SwitchField
          id="u-telephony"
          checked={form.isCloudTelephony}
          onCheckedChange={(value) => setField("isCloudTelephony", value)}
          label="Облачная телефония"
          divider
        />
      )}

      <SwitchField
        id="u-isActive"
        checked={form.isActive}
        onCheckedChange={(value) => setField("isActive", value)}
        label="Активен"
        hint="Выключенный не сможет войти в систему."
        divider
      />

      {isStaff && (
        <SwitchField
          id="u-workStatus"
          checked={form.workStatusEnabled}
          onCheckedChange={(value) => setField("workStatusEnabled", value)}
          label="Показывать в статусах присутствия"
          hint="Бар статусов и Telegram-табло."
          divider
        />
      )}
    </>
  );

  const orgStep = (
    <>
      <div className="tw:grid tw:gap-3 tw:md:grid-cols-2">
        <Field label="Компания" required htmlFor="u-company">
          <Select
            id="u-company"
            placeholder="Выберите компанию"
            isSearchable
            value={form.company}
            options={companiesList}
            getOptionLabel={(option) => option.alias}
            getOptionValue={(option) => option._id}
            onChange={(value) => {
              setField("company", value);
              setField("subdivision", null);
            }}
          />
        </Field>
        <Field label="Подразделение" htmlFor="u-subdivision">
          <Select
            id="u-subdivision"
            placeholder={form.company ? "Выберите подразделение" : "Сначала компания"}
            isSearchable
            isClearable
            isDisabled={!form.company || subdivisions.length === 0}
            value={form.subdivision}
            options={subdivisions}
            getOptionLabel={(option) => option.name}
            getOptionValue={(option) => option._id}
            onChange={(value) => setField("subdivision", value)}
          />
        </Field>
      </div>

      {isStaff && (
        <Field
          label="Ответственный за компании"
          htmlFor="u-responsible"
          hint="Определяет, чьи заявки и людей видит сотрудник."
        >
          <Select
            id="u-responsible"
            placeholder="Выберите компании"
            isMulti
            isClearable
            isSearchable
            closeMenuOnSelect={false}
            value={form.responsibleForCompanies}
            options={companiesList}
            getOptionLabel={(option) => option.alias}
            getOptionValue={(option) => option._id}
            onChange={(value) => setField("responsibleForCompanies", value || [])}
          />
        </Field>
      )}
    </>
  );

  const rightsStep = (
    <>
      <div className="tw:mb-4 tw:rounded-xl tw:border tw:border-border tw:p-4">
        <SwitchField
          id="u-isAdmin"
          checked={form.isAdmin}
          onCheckedChange={(value) => setField("isAdmin", value)}
          label="Администратор"
          hint="Полный доступ ко всему порталу — переключатели ниже теряют смысл."
          className="tw:py-0"
        />
      </div>
      {PERMISSION_MODULES.map((module) =>
        moduleBlock(module, form.permissions, togglePerm),
      )}
      {moduleBlock(DASHBOARD_MODULE, form.dashboard, toggleDash)}
    </>
  );

  const extraStep = (
    <>
      <div className="tw:mb-2 tw:text-sm tw:font-semibold">Уведомления</div>
      {notifyDirty && (
        <div className="tw:mb-3">
          <AlertMessage
            variant="warning"
            message="Это личные настройки пользователя — при сохранении его выбор будет перезаписан."
          />
        </div>
      )}
      <div className="tw:mb-5 tw:overflow-x-auto tw:rounded-xl tw:border tw:border-border">
        <table className="tw:w-full tw:text-sm">
          <thead>
            <tr className="tw:text-xs tw:font-bold tw:tracking-wide tw:text-faint tw:uppercase">
              <th className="tw:p-3 tw:text-left">Событие</th>
              <th className="tw:p-3">Telegram</th>
              <th className="tw:p-3">Email</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFY_EVENTS.map((event) => (
              <tr key={event.key} className="tw:border-t tw:border-border-soft">
                <td className="tw:p-3 tw:font-medium">{event.label}</td>
                {["byTelegram", "byEmail"].map((channel) => (
                  <td key={channel} className="tw:p-3">
                    <div className="tw:flex tw:justify-center">
                      <SwitchField
                        id={`n-${channel}-${event.key}`}
                        checked={!!form.notify[channel][event.key]}
                        onCheckedChange={() => toggleNotify(channel, event.key)}
                        label=""
                        className="tw:py-0"
                      />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEditFinances && isStaff && (
        <>
          <div className="tw:mt-5 tw:mb-2 tw:text-sm tw:font-semibold">
            Финансы
          </div>
          <div className="tw:grid tw:gap-3 tw:md:grid-cols-2">
          <Field
            label="Оклад, ₽/мес"
            htmlFor="u-salary"
            hint="Отображается в персональном отчёте сотрудника."
          >
            <Input
              id="u-salary"
              type="number"
              min="0"
              step="1"
              value={form.finances.salary}
              onChange={(event) =>
                setField("finances", { ...form.finances, salary: event.target.value })
              }
            />
          </Field>
          <Field
            label="Ставка переработок, ₽/час"
            htmlFor="u-overtime"
            hint="Доплата = часы × ставка × коэффициент из настроек."
          >
            <Input
              id="u-overtime"
              type="number"
              min="0"
              step="1"
              value={form.finances.overtimeHourlyRate}
              onChange={(event) =>
                setField("finances", {
                  ...form.finances,
                  overtimeHourlyRate: event.target.value,
                })
              }
            />
          </Field>
          </div>
        </>
      )}

      {canEditGetScreen && (
        <Field
          label="Pro32Connect API"
          htmlFor="u-getscreen"
          hint="Ключ интеграции удалённого подключения."
        >
          <Input
            id="u-getscreen"
            value={form.getScreenApi}
            onChange={(event) => setField("getScreenApi", event.target.value)}
          />
        </Field>
      )}
    </>
  );

  const bodyFor = (key) =>
    ({ person: personStep, org: orgStep, rights: rightsStep, extra: extraStep })[key];

  return (
    <div>
      <h1 className="tw:my-0 tw:mb-4 tw:pr-10 tw:text-2xl tw:font-semibold tw:tracking-tight">
        {isEdit ? "Изменить пользователя" : "Новый пользователь"}
      </h1>

      {isEdit ? (
        <div className="tw:space-y-1">
          {stepKeys.map((key) => (
            <section
              key={key}
              className="tw:border-t tw:border-border-soft tw:py-5 tw:first:border-t-0 tw:first:pt-1"
            >
              <h3 className="tw:my-0 tw:mb-4 tw:text-base tw:font-semibold tw:tracking-tight">
                {titles[key]}
              </h3>
              {bodyFor(key)}
            </section>
          ))}
        </div>
      ) : (
        <>
          <WizardStepper
            steps={STEPS}
            current={step}
            maxReached={maxReached}
            onStepClick={handleStepClick}
          />
          <div className="tw:mt-6 tw:flex tw:flex-col tw:gap-6 tw:md:flex-row">
            <div className="tw:min-w-0 tw:flex-1">
              <h3 className="tw:my-0 tw:mb-4 tw:text-base tw:font-semibold tw:tracking-tight">
                {titles[stepKeys[step]]}
              </h3>
              {bodyFor(stepKeys[step])}
              {attempted && stepError(stepKeys[step]) && (
                <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-destructive">
                  {stepError(stepKeys[step])}
                </p>
              )}
            </div>
            <div className="tw:md:w-72 tw:md:flex-none">
              <FormSummary form={form} kind={kind} />
            </div>
          </div>
        </>
      )}

      {fetcher.data && fetcher.data.error && (
        <div className="tw:mt-4">
          <AlertMessage variant="danger" message={fetcher.data.message} />
        </div>
      )}

      <div className="tw:sticky tw:bottom-0 tw:-mx-6 tw:mt-6 tw:flex tw:items-center tw:gap-2.5 tw:border-t tw:border-border-soft tw:bg-background tw:px-6 tw:py-3">
        <Button type="button" variant="ghost" onClick={handleClose} disabled={saving}>
          Отмена
        </Button>
        <div className="tw:ml-auto tw:flex tw:items-center tw:gap-2.5">
          {isEdit ? (
            <Button type="button" onClick={handleSubmit} disabled={saving}>
              <RiCheckLine /> Сохранить
            </Button>
          ) : (
            <>
              {step > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  disabled={saving}
                >
                  <RiArrowLeftLine /> Назад
                </Button>
              )}
              {step < LAST && (
                <Button type="button" onClick={handleNext}>
                  Далее <RiArrowRightLine />
                </Button>
              )}
              {step === LAST && (
                <Button type="button" onClick={handleSubmit} disabled={saving}>
                  <RiCheckLine /> Сохранить
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserForm;
