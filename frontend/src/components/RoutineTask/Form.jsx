import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiCloseLine,
  RiFileList3Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";
import WizardStepper from "@/components/app/WizardStepper";
import { FormHeader, FormSections } from "@/components/app/FormLayout";
import AlertMessage from "@/components/app/AlertMessage";
import Checklist from "@/components/app/Checklist";
import ScheduleBuilder from "@/components/app/ScheduleBuilder";
import { isValidCron } from "@/util/cron";
import { cn } from "@/lib/utils";

import Select from "../../UI/Select";
import MarkdownEditor from "../../UI/MarkdownEditor";
import useOffcanvasStore from "../../store/offcanvas";
import { getLocalStorageData } from "../../util/auth";
import Summary from "./Summary";

const STEPS = [{ label: "Основное" }, { label: "Расписание" }, { label: "Чек-лист" }];
const LAST = STEPS.length - 1;
const CHECKLIST_STEP = 2;
// Ключи секций правки = якоря: ярлык «Изменить» у чек-листа на карточке
// ведёт сюда хешем (update#checklist)
const SECTION_KEYS = ["basic", "schedule", "checklist"];

const stepMeta = [
  { title: "Основное", desc: "Тема, описание, куда пойдёт заявка и кто отвечает" },
  { title: "Расписание", desc: "Когда автоматически создавать заявку" },
  {
    title: "Чек-лист",
    desc: "Шаги попадут в каждую созданную заявку. Необязательно — можно пропустить и добавить позже.",
  },
];

const fullName = (person) =>
  `${person?.lastName || ""} ${person?.firstName || ""}`.trim();

const RoutineTaskForm = () => {
  // Липкая шапка формы: под неё прижимается рейл секций
  const [headHeight, setHeadHeight] = useState(0);

  const { task = {}, formData = {}, prefillTemplate = null } = useLoaderData();
  const isEdit = !!task._id;
  // При создании из шаблона — сид для предзаполнения (копия-снимок).
  const seed = !isEdit && prefillTemplate ? prefillTemplate : null;

  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

  const [form, setForm] = useState({
    title: task.title || seed?.title || "",
    description: task.description || seed?.description || "",
    company: task.company?._id
      ? task.company
      : seed?.company?._id
        ? seed.company
        : null,
    applicant: task.applicant?._id ? task.applicant : null,
    category: task.category?._id ? task.category : seed?.categoryId || null,
    isActive: isEdit ? !!task.isActive : true,
  });
  const [responsibles, setResponsibles] = useState(task.responsibles || []);
  const [checklist, setChecklist] = useState(
    task.checklist || seed?.checklist || [],
  );
  const [cronSchedule, setCronSchedule] = useState(task.cronSchedule || "");
  const [sourceTemplate, setSourceTemplate] = useState(
    task.sourceTemplate?._id
      ? task.sourceTemplate
      : seed
        ? { _id: seed._id, title: seed.title }
        : null,
  );

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(isEdit ? LAST : 0);
  const [attempted, setAttempted] = useState(false);

  const setField = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  // Выбор шаблона-основы (только при создании): тянем поля снимком.
  const applyTemplate = async (tpl) => {
    if (!tpl?._id) {
      setSourceTemplate(null);
      return;
    }
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/${tpl._id}`,
        { headers: { Authorization: "Bearer " + token } },
      );
      if (!response.ok) throw response;
      const full = await response.json();
      setForm((prev) => ({
        ...prev,
        title: full.title || "",
        description: full.description || "",
        category: full.categoryId || null,
        company: full.company?._id ? full.company : prev.company,
      }));
      setChecklist(full.checklist || []);
      setSourceTemplate({ _id: full._id, title: full.title });
    } catch {
      // при сбое просто не заполняем — пользователь введёт вручную
    }
  };

  const stepValid = (index) => {
    if (index === 0)
      return (
        form.title.trim() !== "" &&
        !!form.company &&
        !!form.applicant &&
        !!form.category
      );
    if (index === 1) return isValidCron(cronSchedule);
    return true;
  };
  const stepError = (index) => {
    if (index === 0 && !stepValid(0))
      return "Заполните тему, категорию, компанию и инициатора";
    if (index === 1 && !stepValid(1)) return "Проверьте расписание";
    return null;
  };

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
    if (!stepValid(1)) {
      setStep(1);
      setAttempted(true);
      return;
    }
    const payload = {
      title: form.title.trim(),
      description: form.description,
      cronSchedule,
      isActive: form.isActive,
      companyId: form.company?._id || null,
      applicantId: form.applicant?._id || null,
      categoryId: form.category?._id || null,
      responsibles: responsibles.map((r) => ({
        _id: r._id,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        phone: r.phone,
        position: r.position,
        role: r.role,
        isActive: r.isActive,
      })),
      sourceTemplate: sourceTemplate
        ? { _id: sourceTemplate._id, title: sourceTemplate.title }
        : null,
      checklist: checklist
        .filter((item) => (item.description || "").trim() !== "")
        .map((item) => ({
          description: item.description,
          mandatory: !!item.mandatory,
        })),
    };
    fetcher.submit(payload, { method: "post", encType: "application/json" });
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      offcanvas.setClose();
      navigate("..");
    }
  }, [fetcher.state, fetcher.data]);

  /* ---------- «Основа» (шаблон-источник) ---------- */
  const sourceBlock = sourceTemplate ? (
    <div className="tw:mb-5 tw:flex tw:items-center tw:gap-3 tw:rounded-xl tw:border tw:border-primary/25 tw:bg-primary/6 tw:p-3 tw:pl-3.5">
      <span className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-primary/15 tw:text-accent-text tw:[&_svg]:size-5">
        <RiFileList3Line />
      </span>
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:text-sm tw:font-semibold">
          Основа: шаблон «{sourceTemplate.title}»
        </div>
        <div className="tw:text-xs tw:text-muted-foreground">
          Поля скопированы из шаблона; связь сохранится для синхронизации
        </div>
      </div>
      {!isEdit && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setSourceTemplate(null)}
        >
          <RiCloseLine /> Убрать
        </Button>
      )}
    </div>
  ) : (
    !isEdit && (
      <div className="tw:mb-5">
        <Field
          label="Основа (необязательно)"
          htmlFor="rt-source"
          hint="Выберите шаблон — тема, описание, категория и чек-лист заполнятся автоматически"
        >
          <Select
            id="rt-source"
            placeholder="Взять за основу шаблон…"
            isClearable
            isSearchable
            value={null}
            options={formData.templates || []}
            getOptionLabel={(option) => option.title}
            getOptionValue={(option) => option._id}
            onChange={applyTemplate}
          />
        </Field>
      </div>
    )
  );

  /* ---------- содержимое шагов ---------- */
  const basicFields = (
    <>
      <Field label="Тема" htmlFor="rt-title" required>
        <Input
          id="rt-title"
          autoFocus
          value={form.title}
          onChange={(event) => setField("title", event.target.value)}
        />
      </Field>
      <Field label="Описание">
        <div className="tpl-editor tw:overflow-hidden tw:rounded-lg tw:border tw:border-input">
          <MarkdownEditor
            key={sourceTemplate?._id || "rt-blank"}
            initialValue={form.description}
            onChange={(markdown) => setField("description", markdown)}
            height="220px"
            hideModeSwitch
          />
        </div>
      </Field>
      <div className="tw:grid tw:gap-3 tw:md:grid-cols-2">
        <Field label="Категория" htmlFor="rt-category" required>
          <Select
            id="rt-category"
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
        <Field label="Компания" htmlFor="rt-company" required>
          <Select
            id="rt-company"
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
      <Field
        label="Инициатор"
        htmlFor="rt-applicant"
        required
        hint="Заявки создаются от имени сервисного аккаунта"
      >
        <Select
          id="rt-applicant"
          placeholder="Выберите инициатора"
          isClearable
          isSearchable
          value={form.applicant}
          options={formData.serviceAccounts || []}
          getOptionLabel={(option) => option.firstName}
          getOptionValue={(option) => option._id}
          onChange={(selected) => setField("applicant", selected)}
        />
      </Field>
      <Field
        label="Ответственные"
        htmlFor="rt-responsibles"
        hint="Необязательно. Указанные сотрудники сразу назначаются на создаваемую заявку."
      >
        <Select
          id="rt-responsibles"
          placeholder="Не назначать — или выберите сотрудников"
          isMulti
          isClearable
          isSearchable
          closeMenuOnSelect={false}
          value={responsibles}
          options={formData.responsibles || []}
          getOptionLabel={(option) => fullName(option) || "Без имени"}
          getOptionValue={(option) => option._id}
          onChange={(selected) => setResponsibles(selected || [])}
        />
      </Field>
    </>
  );

  const scheduleFields = (
    <>
      <ScheduleBuilder value={cronSchedule} onChange={setCronSchedule} />
      <div className="tw:mt-2 tw:border-t tw:border-border-soft tw:pt-2">
        <SwitchField
          id="rt-active"
          checked={form.isActive}
          onCheckedChange={(checked) => setField("isActive", checked)}
          label="Активно"
          hint="Пока выключено — заявки по расписанию не создаются"
        />
      </div>
    </>
  );

  const stepBody = (index) => {
    if (index === 0) return basicFields;
    if (index === 1) return scheduleFields;
    return (
      <Checklist
        mode="edit"
        framed
        title="Чек-лист"
        items={checklist}
        onChange={setChecklist}
      />
    );
  };

  const summaryForm = { ...form, responsibles };

  return (
    <div>
      <FormHeader
        title={isEdit ? "Изменить регламент" : "Новый регламент"}
        onHeight={setHeadHeight}
      />

      {sourceBlock}

      {isEdit ? (
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
              <Summary
                form={summaryForm}
                cronSchedule={cronSchedule}
                checklistCount={
                  checklist.filter((i) => (i.description || "").trim() !== "")
                    .length
                }
                reached={maxReached}
              />
            </div>
          </div>
        </>
      )}

      {fetcher.data && fetcher.data.error && (
        <div className="tw:mt-4">
          <AlertMessage variant="danger" message={fetcher.data.message} />
        </div>
      )}

      <div
        className={cn(
          "tw:sticky tw:bottom-0 tw:-mx-6 tw:mt-6 tw:flex tw:items-center tw:gap-2.5 tw:border-t tw:border-border-soft tw:bg-background tw:px-6 tw:py-3",
        )}
      >
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
    </div>
  );
};

export default RoutineTaskForm;
