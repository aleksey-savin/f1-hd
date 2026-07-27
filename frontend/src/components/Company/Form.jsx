import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import {
  RiAddLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiCloseLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import PhoneInput from "@/components/app/PhoneInput";
import WizardStepper from "@/components/app/WizardStepper";
import AlertMessage from "@/components/app/AlertMessage";
import ScheduleEditor, {
  SCHEDULE_DAYS,
  emptyDay,
} from "@/components/app/ScheduleEditor";

import Select from "../../UI/Select";
import useOffcanvasStore from "../../store/offcanvas";
import timezones from "../../store/timezones";
import { orgTimezone, tzCity } from "../../util/timezone-display";

import FormSummary from "./FormSummary";

// Форма компании (по согласованному макету): создание — мастер «Основное ·
// Контакты · График работы» со сводкой справа (wide-шторка), правка — плоская
// секциями без шагов. Сабмит — JSON на action маршрута; создание уводит на
// карточку созданной компании, правка возвращает где были.
const STEPS = [
  { label: "Основное" },
  { label: "Контакты" },
  { label: "График работы" },
];
const LAST = STEPS.length - 1;

const STEP_META = [
  {
    title: "Основное",
    desc: "Как компания называется, чьи письма ей принадлежат и кто её ведёт",
  },
  {
    title: "Контакты",
    desc: "Как позвонить и доехать: телефоны, адрес и ссылка на карту",
  },
  {
    title: "График работы",
    desc: "Когда офис открыт — от него живут статус «открыто/закрыто» и тарификация нерабочего времени",
  },
];

// workSchedule → полный объект по дням (недостающие дни — дефолт)
const initSchedule = (existing) =>
  Object.fromEntries(
    SCHEDULE_DAYS.map(([, key]) => [
      key,
      existing?.[key]
        ? {
            isWorking: Boolean(existing[key].isWorking),
            is24hours: Boolean(existing[key].is24hours),
            start: existing[key].start || "09:00",
            end: existing[key].end || "18:00",
          }
        : emptyDay(),
    ]),
  );

const CompanyForm = () => {
  const { company, responsibles: responsiblesList = [] } = useLoaderData();
  const isEdit = Boolean(company?._id);

  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

  const [form, setForm] = useState({
    alias: company?.alias || "",
    fullTitle: company?.fullTitle || "",
    emailDomains: (company?.emailDomains || []).join(", "),
    address: company?.address || "",
    linkToMap: company?.linkToMap || "",
  });

  // Телефоны — динамический список; строкам нужны стабильные ключи, иначе
  // PhoneInput (внутренний стейт маски) «переезжает» при удалении из середины
  const phoneSeq = useRef(0);
  const nextPhoneKey = () => `phone-${phoneSeq.current++}`;
  const [phones, setPhones] = useState(() => {
    const existing = (company?.phones || []).filter(Boolean);
    const rows = (existing.length ? existing : [""]).map((value) => ({
      key: nextPhoneKey(),
      value,
    }));
    return rows;
  });

  const [responsibles, setResponsibles] = useState(company?.responsibles || []);
  const [clientsSideResponsibles, setClientsSideResponsibles] = useState(
    company?.clientsSideResponsibles || [],
  );
  const [schedule, setSchedule] = useState(initSchedule(company?.workSchedule));
  // Пояс, в котором читается график: пусто = как в организации. У клиента с
  // филиалами в разных поясах каждый филиал переопределяет его у себя
  const [timezone, setTimezone] = useState(
    () => timezones.find((zone) => zone.value === company?.timezone) || null,
  );

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(isEdit ? LAST : 0);
  const [attempted, setAttempted] = useState(false);

  const setField = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  const setPhone = (key, value) =>
    setPhones((prev) =>
      prev.map((row) => (row.key === key ? { ...row, value } : row)),
    );
  const addPhone = () =>
    setPhones((prev) => [...prev, { key: nextPhoneKey(), value: "" }]);
  const removePhone = (key) =>
    setPhones((prev) => {
      const next = prev.filter((row) => row.key !== key);
      return next.length ? next : [{ key: nextPhoneKey(), value: "" }];
    });

  // Обязательные поля есть только на первом шаге
  const stepValid = (index) =>
    index !== 0 ||
    (form.alias.trim() !== "" &&
      form.fullTitle.trim() !== "" &&
      responsibles.length > 0);

  const stepError = (index) =>
    index === 0 && !stepValid(0)
      ? "Заполните наименования и выберите хотя бы одного ответственного"
      : null;

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
      alias: form.alias.trim(),
      fullTitle: form.fullTitle.trim(),
      // Бэкенд сплитит строку доменов сам (легаси-контракт сохранён)
      emailDomains: form.emailDomains,
      phones: phones.map((row) => row.value.trim()).filter(Boolean),
      address: form.address.trim(),
      linkToMap: form.linkToMap.trim(),
      responsibles: responsibles.map((resp) => resp._id),
      workSchedule: schedule,
      timezone: timezone?.value || null,
      ...(isEdit
        ? {
            clientsSideResponsibles: clientsSideResponsibles.map(
              (resp) => resp._id,
            ),
          }
        : {}),
    };

    fetcher.submit(payload, { method: "post", encType: "application/json" });
  };

  // Успех: создание → карточка созданной компании, правка → где были
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      offcanvas.setClose();
      if (!isEdit && fetcher.data.company?._id) {
        navigate(`/companies/${fetcher.data.company._id}`);
      } else {
        navigate("..");
      }
    }
  }, [fetcher.state, fetcher.data]);

  const stepBody = (index) => {
    if (index === 0) {
      return (
        <div>
          <div className="tw:grid tw:gap-x-3 tw:md:grid-cols-2">
            <Field label="Короткое наименование" htmlFor="alias" required>
              <Input
                id="alias"
                autoFocus={!isEdit}
                value={form.alias}
                onChange={(event) => setField("alias", event.target.value)}
              />
            </Field>
            <Field label="Полное наименование" htmlFor="fullTitle" required>
              <Input
                id="fullTitle"
                value={form.fullTitle}
                onChange={(event) => setField("fullTitle", event.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Почтовые домены"
            htmlFor="emailDomains"
            hint="Через запятую, без «@» — по ним опознаются входящие письма."
          >
            <Input
              id="emailDomains"
              placeholder="company.ru, company.spb.ru"
              value={form.emailDomains}
              onChange={(event) => setField("emailDomains", event.target.value)}
            />
          </Field>
          <Field
            label="Ответственные"
            htmlFor="responsibles"
            required
            hint="Сотрудники, ведущие эту компанию, — видят её в своих списках и заявках."
          >
            <Select
              id="responsibles"
              placeholder="Выберите сотрудников"
              closeMenuOnSelect={false}
              isClearable
              isSearchable
              isMulti
              value={responsibles}
              options={responsiblesList}
              getOptionLabel={(option) =>
                `${option.lastName} ${option.firstName}`
              }
              getOptionValue={(option) => option._id}
              onChange={(selected) => setResponsibles(selected || [])}
            />
          </Field>
          {isEdit && (
            <Field
              label="Ответственные со стороны клиента"
              htmlFor="clientsSideResponsibles"
              hint="Выбор из сотрудников компании."
            >
              <Select
                id="clientsSideResponsibles"
                placeholder="Выберите сотрудников"
                closeMenuOnSelect={false}
                isClearable
                isSearchable
                isMulti
                value={clientsSideResponsibles}
                options={company?.employees || []}
                getOptionLabel={(option) =>
                  `${option.lastName} ${option.firstName}`
                }
                getOptionValue={(option) => option._id}
                onChange={(selected) =>
                  setClientsSideResponsibles(selected || [])
                }
              />
            </Field>
          )}
        </div>
      );
    }

    if (index === 1) {
      return (
        <div>
          <Field label="Телефоны">
            <div className="tw:grid tw:gap-2">
              {phones.map((row) => (
                <div key={row.key} className="tw:flex tw:items-center tw:gap-1.5">
                  <div className="tw:min-w-0 tw:flex-1">
                    <PhoneInput
                      id={row.key}
                      name={row.key}
                      value={row.value}
                      setValue={(value) => setPhone(row.key, value)}
                    />
                  </div>
                  {(phones.length > 1 || row.value) && (
                    <button
                      type="button"
                      onClick={() => removePhone(row.key)}
                      title="Убрать телефон"
                      aria-label="Убрать телефон"
                      className="tw:grid tw:size-8 tw:flex-none tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:text-faint tw:transition-colors tw:hover:bg-accent tw:hover:text-destructive"
                    >
                      <RiCloseLine size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addPhone}
              className="tw:mt-2 tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:font-semibold tw:text-accent-text tw:hover:underline"
            >
              <RiAddLine size={15} /> Ещё телефон
            </button>
          </Field>
          <Field label="Адрес" htmlFor="address">
            <Input
              id="address"
              value={form.address}
              onChange={(event) => setField("address", event.target.value)}
            />
          </Field>
          <Field
            label="Ссылка на карту"
            htmlFor="linkToMap"
            hint="Открывается из адреса; из координат в ссылке строится маршрут такси."
          >
            <Input
              id="linkToMap"
              placeholder="https://yandex.ru/maps/…"
              value={form.linkToMap}
              onChange={(event) => setField("linkToMap", event.target.value)}
            />
          </Field>
        </div>
      );
    }

    return (
      <>
        <Field
          label="Часовой пояс"
          hint={
            timezone
              ? "В нём читается график ниже и показывается местное время клиента."
              : `Пусто — как в организации: ${tzCity(orgTimezone())}.`
          }
        >
          <Select
            isClearable
            isSearchable
            placeholder={`Как в организации — ${tzCity(orgTimezone())}`}
            options={timezones}
            value={timezone}
            onChange={(next) => setTimezone(next || null)}
          />
        </Field>
        <ScheduleEditor schedule={schedule} onChange={setSchedule} />
      </>
    );
  };

  return (
    <div>
      <h1 className="tw:my-0 tw:mb-4 tw:pr-10 tw:text-2xl tw:font-semibold tw:tracking-tight">
        {isEdit ? "Изменить компанию" : "Новая компания"}
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
                {STEP_META[index].title}
              </h3>
              <p className="tw:mt-0.5 tw:mb-4 tw:text-sm tw:text-muted-foreground">
                {STEP_META[index].desc}
              </p>
              {stepBody(index)}
            </section>
          ))}
        </div>
      ) : (
        // Создание — мастер со сводкой
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
                  {STEP_META[step].title}
                </h3>
                <p className="tw:mt-0.5 tw:mb-0 tw:text-sm tw:text-muted-foreground">
                  {STEP_META[step].desc}
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
              <FormSummary
                form={form}
                phones={phones}
                responsibles={responsibles}
                schedule={schedule}
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

      <div className="tw:sticky tw:bottom-0 tw:-mx-6 tw:mt-6 tw:flex tw:items-center tw:gap-2.5 tw:border-t tw:border-border-soft tw:bg-background tw:px-6 tw:py-3">
        <Button
          type="button"
          variant="ghost"
          onClick={handleClose}
          disabled={saving}
        >
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

export default CompanyForm;
