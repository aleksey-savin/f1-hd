import { useContext, useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
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
import { FormHeader, FormSections } from "@/components/app/FormLayout";
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

import Combobox, { MultiCombobox, toOptions } from "@/components/app/Combobox";
import MarkdownEditor from "../../UI/MarkdownEditor";
import { useFormSheet } from "@/components/app/FormOutlet";
import useToastStore from "../../store/toast-store";
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
// Ключи секций правки = якоря: ярлык «Изменить» у чек-листа на карточке
// ведёт сюда хешем (update#checklist)
const SECTION_KEYS = ["basic", "fields", "checklist", "access"];

const TicketTemplateForm = () => {
  // Липкая шапка формы: под неё прижимается рейл секций
  const [headHeight, setHeadHeight] = useState(0);

  const { template = {}, formData = {} } = useLoaderData();
  const isEdit = !!template._id;

  const { isEndUser } = useContext(AuthedUserContext);
  const fetcher = useFetcher();
  const { close } = useFormSheet();

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

  const handleClose = () => close();

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
      sharedUsers: shareUsers ? form.sharedUsers.map((user) => user._id) : [],
    };
    fetcher.submit(payload, { method: "post", encType: "application/json" });
  };

  const finishClose = () => {
    setSyncOpen(false);
    close("..");
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      const children = fetcher.data.childRoutines || [];
      if (isEdit && children.length > 0) {
        setChildRoutines(children);
        setSyncIds(children.map((routine) => routine._id));
        setSyncOpen(true);
      } else {
        close("..");
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
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/${template._id}/sync-routines`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
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
        <div className="md-editor overflow-hidden rounded-lg border border-input">
          <MarkdownEditor
            initialValue={template.description}
            onChange={(markdown) => setField("description", markdown)}
            height="240px"
            hideModeSwitch
          />
        </div>
      </Field>
      {!isEndUser && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Категория" htmlFor="tpl-category">
            <Combobox
              id="tpl-category"
              placeholder="Выберите категорию"
              value={form.category?._id ? String(form.category._id) : null}
              options={toOptions(formData.categories || [], {
                value: (option) => String(option._id),
                label: (option) => option.title,
              })}
              onChange={(id) =>
                setField(
                  "category",
                  (formData.categories || []).find(
                    (option) => String(option._id) === id,
                  ) || null,
                )
              }
              clearable
              clearLabel="Не выбрано"
            />
          </Field>
          <Field label="Компания" htmlFor="tpl-company">
            <Combobox
              id="tpl-company"
              placeholder="Выберите компанию"
              value={form.company?._id ? String(form.company._id) : null}
              options={toOptions(formData.companies || [], {
                value: (option) => String(option._id),
                label: (option) => option.alias,
              })}
              onChange={(id) =>
                setField(
                  "company",
                  (formData.companies || []).find(
                    (option) => String(option._id) === id,
                  ) || null,
                )
              }
              clearable
              clearLabel="Не выбрано"
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
        <div className="mb-2 pl-13">
          <MultiCombobox
            id="tpl-shared-companies"
            placeholder="Выберите компании"
            value={(form.sharedCompanies || []).map((item) => String(item._id))}
            options={toOptions(formData.companies || [], {
              value: (option) => String(option._id),
              label: (option) => option.alias,
            })}
            onChange={(ids) =>
              setField(
                "sharedCompanies",
                (formData.companies || []).filter((option) =>
                  ids.includes(String(option._id)),
                ),
              )
            }
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
        <div className="mb-2 pl-13">
          <MultiCombobox
            id="tpl-shared-users"
            placeholder="Выберите пользователей"
            value={(form.sharedUsers || []).map((item) => String(item._id))}
            options={toOptions(formData.applicants || [], {
              value: (option) => String(option._id),
              label: (option) =>
                `${option.lastName || ""} ${option.firstName || ""}`.trim(),
            })}
            onChange={(ids) =>
              setField(
                "sharedUsers",
                (formData.applicants || []).filter((option) =>
                  ids.includes(String(option._id)),
                ),
              )
            }
          />
        </div>
      )}
    </>
  );

  const stepBody = (index) => {
    if (index === 0) return basicFields;
    if (index === 1)
      return (
        <CustomFieldsEditor value={customFields} onChange={setCustomFields} />
      );
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
      <FormHeader
        title={isEdit ? "Изменить шаблон" : "Новый шаблон"}
        onHeight={setHeadHeight}
      />

      {isEdit ? (
        // Правка — плоская форма без шагов
        <FormSections
          headHeight={headHeight}
          sections={STEPS.map((meta, index) => ({
            key: SECTION_KEYS[index],
            title: stepMeta[index].title,
            desc: stepMeta[index].desc,
            body: stepBody(index),
          }))}
        />
      ) : (
        // Создание — мастер
        <>
          <WizardStepper
            steps={STEPS}
            current={step}
            maxReached={maxReached}
            onStepClick={handleStepClick}
          />
          <div className="mt-6 flex flex-col gap-6 md:flex-row">
            <div className="min-w-0 flex-1">
              <div className="mb-4">
                <h3 className="my-0 text-base font-semibold tracking-tight">
                  {stepMeta[step].title}
                </h3>
                <p className="mt-0.5 mb-0 text-sm text-muted-foreground">
                  {stepMeta[step].desc}
                </p>
              </div>
              {stepBody(step)}
              {attempted && stepError(step) && (
                <p className="mt-2 mb-0 text-sm text-destructive">
                  {stepError(step)}
                </p>
              )}
            </div>
            <div className="md:w-72 md:flex-none">
              <Summary form={summaryForm} reached={maxReached} />
            </div>
          </div>
        </>
      )}

      {fetcher.data && fetcher.data.error && (
        <div className="mt-4">
          <AlertMessage variant="danger" message={fetcher.data.message} />
        </div>
      )}

      <div className="sticky bottom-0 -mx-6 mt-6 flex items-center gap-2.5 border-t border-border-soft bg-background px-6 py-3">
        <Button
          type="button"
          variant="ghost"
          onClick={handleClose}
          disabled={saving}
        >
          Отмена
        </Button>
        <div className="ml-auto flex items-center gap-2.5">
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

          <div className="flex items-center justify-between px-0.5">
            <span className="text-xs font-bold tracking-wider text-faint uppercase">
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
              className="cursor-pointer appearance-none border-0 bg-transparent text-sm font-semibold text-accent-text"
            >
              {syncIds.length === childRoutines.length
                ? "Снять все"
                : "Выбрать все"}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
            {childRoutines.map((routine) => (
              <label
                key={routine._id}
                className="flex cursor-pointer items-center gap-3 border-t border-border-soft p-3 first:border-t-0"
              >
                <Checkbox
                  checked={syncIds.includes(routine._id)}
                  onCheckedChange={() => toggleSync(routine._id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {routine.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {describeCron(routine.cronSchedule)}
                    {routine.company?.alias
                      ? ` · ${routine.company.alias}`
                      : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <AlertDialogFooter>
            <Button variant="ghost" onClick={finishClose} disabled={syncing}>
              Не обновлять
            </Button>
            <Button
              onClick={applySync}
              disabled={syncing || syncIds.length === 0}
            >
              <RiRefreshLine /> Обновить выбранные ({syncIds.length})
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TicketTemplateForm;
