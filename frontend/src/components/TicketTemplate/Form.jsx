import { useContext, useEffect, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiRefreshLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";
import WizardStepper from "@/components/app/WizardStepper";
import AlertMessage from "@/components/app/AlertMessage";
import Checklist from "@/components/app/Checklist";
import CustomFieldsEditor, {
  genFieldKey,
} from "@/components/app/CustomFieldsEditor";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { describeCron } from "@/util/cron";

import Select from "../../UI/Select";
import MarkdownEditor from "../../UI/MarkdownEditor";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { getLocalStorageData } from "../../util/auth";
import { AuthedUserContext } from "../../store/authed-user-context";
import Summary from "./Summary";

const STEPS = [
  { label: "Основное" },
  { label: "Поля формы" },
  { label: "Чек-лист" },
  { label: "Доступ" },
];
const LAST = STEPS.length - 1;
const CHECKLIST_STEP = 2;

const TicketTemplateForm = () => {
  const { template = {}, formData = {} } = useLoaderData();
  const isEdit = !!template._id;

  const { isEndUser } = useContext(AuthedUserContext);
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

  const [form, setForm] = useState({
    title: template.title || "",
    description: template.description || "",
    category: template.categoryId || null,
    company: template.company?._id ? template.company : null,
    allowAllStaff: !!template.allowAllStaff,
    sharedCompanies: template.sharedCompanies || [],
    sharedUsers: template.sharedUsers || [],
  });
  const [customFields, setCustomFields] = useState(
    (template.customFields || []).map((field) => ({
      ...field,
      _key: genFieldKey(),
    })),
  );
  const [checklist, setChecklist] = useState(template.checklist || []);
  const [shareCompanies, setShareCompanies] = useState(
    (template.sharedCompanies || []).length > 0,
  );
  const [shareUsers, setShareUsers] = useState(
    (template.sharedUsers || []).length > 0,
  );

  // Правка — плоская форма без шагов; создание — мастер по шагам.
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(isEdit ? LAST : 0);
  const [attempted, setAttempted] = useState(false);

  // Синхронизация регламентов-потомков после правки шаблона.
  const { showToast } = useToastStore();
  const [childRoutines, setChildRoutines] = useState([]);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncIds, setSyncIds] = useState([]);
  const [syncing, setSyncing] = useState(false);

  const setField = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  const stepValid = (index) => index !== 0 || form.title.trim() !== "";
  const stepError = (index) =>
    index === 0 && !stepValid(0) ? "Укажите тему шаблона" : null;

  const handleNext = () => {
    if (!stepValid(step)) {
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
    if (!stepValid(0)) {
      setStep(0);
      setAttempted(true);
      return;
    }
    const payload = {
      title: form.title.trim(),
      description: form.description,
      categoryId: form.category?._id || null,
      company: form.company?._id || null,
      customFields: customFields
        .filter((field) => (field.name || "").trim() !== "")
        .map((field) => ({
          name: field.name,
          type: field.type,
          options: field.options || [],
          value: field.value ?? "",
        })),
      checklist: checklist
        .filter((item) => (item.description || "").trim() !== "")
        .map((item) => ({
          description: item.description,
          mandatory: !!item.mandatory,
        })),
      allowAllStaff: form.allowAllStaff,
      sharedCompanies: shareCompanies
        ? form.sharedCompanies.map((company) => company._id)
        : [],
      sharedUsers: shareUsers
        ? form.sharedUsers.map((user) => user._id)
        : [],
    };
    fetcher.submit(payload, { method: "post", encType: "application/json" });
  };

  const finishClose = () => {
    setSyncOpen(false);
    offcanvas.setClose();
    navigate("..");
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      const children = fetcher.data.childRoutines || [];
      if (isEdit && children.length > 0) {
        setChildRoutines(children);
        setSyncIds(children.map((routine) => routine._id));
        setSyncOpen(true);
      } else {
        offcanvas.setClose();
        navigate("..");
      }
    }
  }, [fetcher.state, fetcher.data]);

  const toggleSync = (id) =>
    setSyncIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  const applySync = async () => {
    setSyncing(true);
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/${template._id}/sync-routines`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ routineIds: syncIds }),
        },
      );
      const data = await response.json().catch(() => ({}));
      showToast(
        "success",
        `Обновлено регламентов: ${data.updated ?? syncIds.length}`,
      );
    } catch {
      showToast("danger", "Не удалось обновить регламенты");
    }
    setSyncing(false);
    finishClose();
  };

  /* ---------- Содержимое шагов ---------- */

  const basicFields = (
    <>
      <Field label="Тема" htmlFor="tpl-title" required>
        <Input
          id="tpl-title"
          autoFocus
          value={form.title}
          onChange={(event) => setField("title", event.target.value)}
        />
      </Field>
      <Field label="Описание">
        <div className="tpl-editor tw:overflow-hidden tw:rounded-lg tw:border tw:border-input">
          <MarkdownEditor
            initialValue={template.description}
            onChange={(markdown) => setField("description", markdown)}
            height="240px"
            hideModeSwitch
          />
        </div>
      </Field>
      {!isEndUser && (
        <div className="tw:grid tw:gap-3 tw:md:grid-cols-2">
          <Field label="Категория" htmlFor="tpl-category">
            <Select
              id="tpl-category"
              placeholder="Выберите категорию"
              isClearable
              isSearchable
              value={form.category}
              options={formData.categories || []}
              getOptionLabel={(option) => option.title}
              getOptionValue={(option) => option._id}
              onChange={(selected) => setField("category", selected)}
            />
          </Field>
          <Field label="Компания" htmlFor="tpl-company">
            <Select
              id="tpl-company"
              placeholder="Выберите компанию"
              isClearable
              isSearchable
              value={form.company}
              options={formData.companies || []}
              getOptionLabel={(option) => option.alias}
              getOptionValue={(option) => option._id}
              onChange={(selected) => setField("company", selected)}
            />
          </Field>
        </div>
      )}
    </>
  );

  const accessFields = (
    <>
      <SwitchField
        id="tpl-all-staff"
        checked={form.allowAllStaff}
        onCheckedChange={(checked) => setField("allowAllStaff", checked)}
        label="Доступен всем сотрудникам"
        hint="Любой внутренний сотрудник увидит шаблон при создании заявки"
      />
      {!isEndUser && (
        <SwitchField
          id="tpl-share-companies"
          checked={shareCompanies}
          onCheckedChange={(checked) => {
            setShareCompanies(checked);
            if (!checked) setField("sharedCompanies", []);
          }}
          label="Поделиться с компаниями"
          hint="Клиенты выбранных компаний увидят шаблон"
          divider
        />
      )}
      {!isEndUser && shareCompanies && (
        <div className="tw:mb-2 tw:pl-13">
          <Select
            id="tpl-shared-companies"
            placeholder="Выберите компании"
            isMulti
            isClearable
            isSearchable
            value={form.sharedCompanies}
            options={formData.companies || []}
            getOptionLabel={(option) => option.alias}
            getOptionValue={(option) => option._id}
            onChange={(selected) => setField("sharedCompanies", selected || [])}
          />
        </div>
      )}
      <SwitchField
        id="tpl-share-users"
        checked={shareUsers}
        onCheckedChange={(checked) => {
          setShareUsers(checked);
          if (!checked) setField("sharedUsers", []);
        }}
        label="Поделиться с пользователями"
        hint="Отдельные сотрудники или клиенты"
        divider
      />
      {shareUsers && (
        <div className="tw:mb-2 tw:pl-13">
          <Select
            id="tpl-shared-users"
            placeholder="Выберите пользователей"
            isMulti
            isClearable
            isSearchable
            closeMenuOnSelect={false}
            value={form.sharedUsers}
            options={formData.applicants || []}
            getOptionLabel={(option) =>
              `${option.lastName || ""} ${option.firstName || ""}`.trim()
            }
            getOptionValue={(option) => option._id}
            onChange={(selected) => setField("sharedUsers", selected || [])}
          />
        </div>
      )}
    </>
  );

  const stepBody = (index) => {
    if (index === 0) return basicFields;
    if (index === 1)
      return <CustomFieldsEditor value={customFields} onChange={setCustomFields} />;
    if (index === 2)
      return (
        <Checklist
          mode="edit"
          framed
          title="Чек-лист"
          items={checklist}
          onChange={setChecklist}
        />
      );
    return accessFields;
  };

  const stepMeta = [
    { title: "Основное", desc: "Тема заявки, категория и компания" },
    { title: "Поля формы", desc: "Что заполнит инициатор при создании заявки" },
    {
      title: "Чек-лист",
      desc: "Шаги попадут в каждую заявку. Необязательно — можно пропустить и добавить позже на карточке.",
    },
    { title: "Доступ", desc: "Кому шаблон виден при создании заявки" },
  ];

  const summaryForm = { ...form, customFields, checklist };

  /* ---------- Разметка ---------- */

  return (
    <div>
      <h1 className="tw:my-0 tw:mb-4 tw:pr-10 tw:text-2xl tw:font-semibold tw:tracking-tight">
        {isEdit ? "Изменить шаблон" : "Новый шаблон"}
      </h1>

      {isEdit ? (
        // Правка — плоская форма без шагов
        <div className="tw:space-y-1">
          {STEPS.map((meta, index) => (
            <section
              key={meta.label}
              className="tw:border-t tw:border-border-soft tw:py-5 tw:first:border-t-0 tw:first:pt-1"
            >
              <h3 className="tw:my-0 tw:text-base tw:font-semibold tw:tracking-tight">
                {stepMeta[index].title}
              </h3>
              <p className="tw:mt-0.5 tw:mb-4 tw:text-sm tw:text-muted-foreground">
                {stepMeta[index].desc}
              </p>
              {stepBody(index)}
            </section>
          ))}
        </div>
      ) : (
        // Создание — мастер
        <>
          <WizardStepper
            steps={STEPS}
            current={step}
            maxReached={maxReached}
            onStepClick={handleStepClick}
          />
          <div className="tw:mt-6 tw:flex tw:flex-col tw:gap-6 tw:md:flex-row">
            <div className="tw:min-w-0 tw:flex-1">
              <div className="tw:mb-4">
                <h3 className="tw:my-0 tw:text-base tw:font-semibold tw:tracking-tight">
                  {stepMeta[step].title}
                </h3>
                <p className="tw:mt-0.5 tw:mb-0 tw:text-sm tw:text-muted-foreground">
                  {stepMeta[step].desc}
                </p>
              </div>
              {stepBody(step)}
              {attempted && stepError(step) && (
                <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-destructive">
                  {stepError(step)}
                </p>
              )}
            </div>
            <div className="tw:md:w-72 tw:md:flex-none">
              <Summary form={summaryForm} reached={maxReached} />
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
              {step === CHECKLIST_STEP && step < LAST && (
                <Button type="button" variant="ghost" onClick={handleNext}>
                  Пропустить
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

      <AlertDialog
        open={syncOpen}
        onOpenChange={(open) => {
          if (!open) finishClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Обновить регламенты по шаблону?</AlertDialogTitle>
            <AlertDialogDescription>
              Этот шаблон используют регламенты. Обновятся тема, описание,
              категория и чек-лист; расписание, инициатор и ответственные — нет.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="tw:flex tw:items-center tw:justify-between tw:px-0.5">
            <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
              Регламенты · {childRoutines.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setSyncIds(
                  syncIds.length === childRoutines.length
                    ? []
                    : childRoutines.map((routine) => routine._id),
                )
              }
              className="tw:cursor-pointer tw:appearance-none tw:border-0 tw:bg-transparent tw:text-sm tw:font-semibold tw:text-accent-text"
            >
              {syncIds.length === childRoutines.length ? "Снять все" : "Выбрать все"}
            </button>
          </div>
          <div className="tw:max-h-64 tw:overflow-y-auto tw:rounded-xl tw:border tw:border-border">
            {childRoutines.map((routine) => (
              <label
                key={routine._id}
                className="tw:flex tw:cursor-pointer tw:items-center tw:gap-3 tw:border-t tw:border-border-soft tw:p-3 tw:first:border-t-0"
              >
                <Checkbox
                  checked={syncIds.includes(routine._id)}
                  onCheckedChange={() => toggleSync(routine._id)}
                />
                <span className="tw:min-w-0 tw:flex-1">
                  <span className="tw:block tw:truncate tw:text-sm tw:font-semibold">
                    {routine.title}
                  </span>
                  <span className="tw:block tw:truncate tw:text-xs tw:text-muted-foreground">
                    {describeCron(routine.cronSchedule)}
                    {routine.company?.alias ? ` · ${routine.company.alias}` : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <AlertDialogFooter>
            <Button variant="ghost" onClick={finishClose} disabled={syncing}>
              Не обновлять
            </Button>
            <Button onClick={applySync} disabled={syncing || syncIds.length === 0}>
              <RiRefreshLine /> Обновить выбранные ({syncIds.length})
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TicketTemplateForm;
