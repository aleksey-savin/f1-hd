import { useContext, useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
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
import {
  FormActions,
  FormHeader,
  FormSections,
  sectionAnchorId,
} from "@/components/app/FormLayout";
import { scrollToSection } from "@/components/app/AnchorRail";
import { OverlayScrollContext } from "@/components/app/overlay-context";
import ScheduleEditor, {
  SCHEDULE_DAYS,
  emptyDay,
} from "@/components/app/ScheduleEditor";

import Combobox, { MultiCombobox, toOptions } from "@/components/app/Combobox";
import { useFormSheet } from "@/components/app/FormOutlet";
import timezones from "../../store/timezones";
import { orgTimezone, tzCity } from "../../util/timezone-display";

import FormSummary from "./FormSummary";
import MapLinkHint from "./MapLinkHint";

// Форма компании (по согласованному макету): создание — мастер «Основное ·
// Контакты · График работы» со сводкой справа (шторка `lg`), правка — те же
// поля плоскими секциями с рейлом-якорем (`app/FormLayout`, шторка `xl`).
// Сабмит — JSON на action маршрута; создание уводит на карточку созданной
// компании, правка возвращает где были.
const STEPS = [
  { label: "Основное" },
  { label: "Контакты" },
  { label: "График работы" },
];
const LAST = STEPS.length - 1;
// Ключи секций правки = якоря: ярлык «Изменить» в метке секции карточки ведёт
// сюда хешем (`update#schedule`)
const SECTION_KEYS = ["basic", "contacts", "schedule"];

const STEP_META = [
  {
    title: "Основное",
    desc: "",
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

  // Липкая шапка формы: под неё прижимается рейл секций
  const [headHeight, setHeadHeight] = useState(0);
  const scroller = useContext(OverlayScrollContext);

  const fetcher = useFetcher();
  const { close } = useFormSheet();

  const [form, setForm] = useState({
    alias: company?.alias || "",
    fullTitle: company?.fullTitle || "",
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

  // Почтовые домены — тот же динамический список, что у телефонов
  const domainSeq = useRef(0);
  const nextDomainKey = () => `domain-${domainSeq.current++}`;
  const [domains, setDomains] = useState(() => {
    const existing = (company?.emailDomains || []).filter(Boolean);
    return (existing.length ? existing : [""]).map((value) => ({
      key: nextDomainKey(),
      value,
    }));
  });

  const [responsibles, setResponsibles] = useState(company?.responsibles || []);
  const [clientsSideResponsibles, setClientsSideResponsibles] = useState(
    company?.clientsSideResponsibles || [],
  );
  const [schedule, setSchedule] = useState(initSchedule(company?.workSchedule));
  // Пояс, в котором читается график: пусто = как в организации. У клиента с
  // филиалами в разных поясах каждый филиал переопределяет его у себя
  const [timezone, setTimezone] = useState(() => company?.timezone || null);

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
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

  const setDomain = (key, value) =>
    setDomains((prev) =>
      prev.map((row) => (row.key === key ? { ...row, value } : row)),
    );
  const addDomain = () =>
    setDomains((prev) => [...prev, { key: nextDomainKey(), value: "" }]);
  const removeDomain = (key) =>
    setDomains((prev) => {
      const next = prev.filter((row) => row.key !== key);
      return next.length ? next : [{ key: nextDomainKey(), value: "" }];
    });
  // Домен из адреса письма: без «@», пробелов и регистра
  const cleanDomains = () =>
    domains
      .map((row) => row.value.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean);

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
    if (index <= maxReached) {
      setAttempted(false);
      setStep(index);
    }
  };

  const handleClose = () => close();

  const saving = fetcher.state !== "idle";

  const handleSubmit = () => {
    if (!stepValid(0)) {
      setAttempted(true);
      // Показать человеку незаполненное поле. В мастере это переключение шага,
      // в правке — прокрутка к секции: шагов там нет, и `setStep` молчал бы,
      // а форма выглядела бы сломанной — нажал «Сохранить», не случилось ничего
      if (isEdit) {
        scrollToSection(scroller, sectionAnchorId(SECTION_KEYS[0]));
      } else {
        setStep(0);
      }
      return;
    }

    const payload = {
      alias: form.alias.trim(),
      fullTitle: form.fullTitle.trim(),
      // Бэкенд сплитит строку доменов сам (легаси-контракт сохранён)
      emailDomains: cleanDomains().join(", "),
      phones: phones.map((row) => row.value.trim()).filter(Boolean),
      address: form.address.trim(),
      linkToMap: form.linkToMap.trim(),
      responsibles: responsibles.map((resp) => resp._id),
      workSchedule: schedule,
      timezone: timezone || null,
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
      if (!isEdit && fetcher.data.company?._id) {
        close(`/companies/${fetcher.data.company._id}`);
      } else {
        close("..");
      }
    }
  }, [fetcher.state, fetcher.data]);

  const stepBody = (index) => {
    if (index === 0) {
      return (
        <div>
          <div className="grid gap-x-3 md:grid-cols-2">
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
            hint="Без «@» — по домену адреса письма опознаётся компания."
          >
            <div className="grid gap-2">
              {domains.map((row) => (
                <div key={row.key} className="flex items-center gap-1.5">
                  <Input
                    id={row.key}
                    placeholder="company.ru"
                    value={row.value}
                    onChange={(event) => setDomain(row.key, event.target.value)}
                    className="min-w-0 flex-1"
                  />
                  {(domains.length > 1 || row.value) && (
                    <button
                      type="button"
                      onClick={() => removeDomain(row.key)}
                      title="Убрать домен"
                      aria-label="Убрать домен"
                      className="grid size-8 flex-none cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-faint transition-colors hover:bg-accent hover:text-destructive"
                    >
                      <RiCloseLine size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addDomain}
              className="mt-2 inline-flex cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-accent-text hover:underline"
            >
              <RiAddLine size={15} /> Ещё домен
            </button>
          </Field>
          <Field
            label="Ответственные"
            htmlFor="responsibles"
            required
            hint="Сотрудники, ведущие эту компанию, — видят её в своих списках и заявках."
          >
            <MultiCombobox
              id="responsibles"
              placeholder="Выберите сотрудников"
              value={(responsibles || []).map((user) => String(user._id))}
              options={toOptions(responsiblesList, {
                value: (option) => String(option._id),
                label: (option) => `${option.lastName} ${option.firstName}`,
              })}
              onChange={(ids) =>
                setResponsibles(
                  responsiblesList.filter((option) =>
                    ids.includes(String(option._id)),
                  ),
                )
              }
            />
          </Field>
          {isEdit && (
            <Field
              label="Ответственные со стороны клиента"
              htmlFor="clientsSideResponsibles"
              hint="Выбор из сотрудников компании."
            >
              <MultiCombobox
                id="clientsSideResponsibles"
                placeholder="Выберите сотрудников"
                value={(clientsSideResponsibles || []).map((user) =>
                  String(user._id),
                )}
                options={toOptions(company?.employees || [], {
                  value: (option) => String(option._id),
                  label: (option) => `${option.lastName} ${option.firstName}`,
                })}
                onChange={(ids) =>
                  setClientsSideResponsibles(
                    (company?.employees || []).filter((option) =>
                      ids.includes(String(option._id)),
                    ),
                  )
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
            <div className="grid gap-2">
              {phones.map((row) => (
                <div key={row.key} className="flex items-center gap-1.5">
                  <div className="min-w-0 flex-1">
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
                      className="grid size-8 flex-none cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-faint transition-colors hover:bg-accent hover:text-destructive"
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
              className="mt-2 inline-flex cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-accent-text hover:underline"
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
            hint={<MapLinkHint url={form.linkToMap} />}
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
          <Combobox
            ariaLabel="Часовой пояс компании"
            placeholder={`Как в организации — ${tzCity(orgTimezone())}`}
            options={timezones}
            value={timezone}
            onChange={setTimezone}
            clearable
            clearLabel={`Как в организации — ${tzCity(orgTimezone())}`}
          />
        </Field>
        <ScheduleEditor schedule={schedule} onChange={setSchedule} />
      </>
    );
  };

  return (
    <div>
      {isEdit ? (
        <FormHeader title="Изменить компанию" onHeight={setHeadHeight} />
      ) : (
        <h1 className="my-0 mb-4 pr-10 text-2xl font-semibold tracking-tight">
          Новая компания
        </h1>
      )}

      {isEdit ? (
        /* Правка — плоские секции одним скроллом, слева рейл-якорь */
        <FormSections
          headHeight={headHeight}
          sections={STEPS.map((meta, index) => ({
            key: SECTION_KEYS[index],
            title: STEP_META[index].title,
            desc: STEP_META[index].desc,
            /* Ошибка обязана быть видна и здесь: в мастере её показывает
               ветка ниже, а в плоской правке показать её больше некому */
            body: (
              <>
                {stepBody(index)}
                {attempted && stepError(index) && (
                  <p className="mt-2 mb-0 text-sm text-destructive">
                    {stepError(index)}
                  </p>
                )}
              </>
            ),
          }))}
        />
      ) : (
        // Создание — мастер со сводкой
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
                  {STEP_META[step].title}
                </h3>
                {/* Описание есть не у каждого шага — пустой абзац не рисуем
                    (как и `FormSections` в правке) */}
                {STEP_META[step].desc && (
                  <p className="mt-0.5 mb-0 text-sm text-muted-foreground">
                    {STEP_META[step].desc}
                  </p>
                )}
              </div>
              {stepBody(step)}
              {attempted && stepError(step) && (
                <p className="mt-2 mb-0 text-sm text-destructive">
                  {stepError(step)}
                </p>
              )}
            </div>
            <div className="md:w-72 md:flex-none">
              <FormSummary
                form={form}
                phones={phones}
                domains={domains}
                responsibles={responsibles}
                schedule={schedule}
                reached={maxReached}
              />
            </div>
          </div>
        </>
      )}

      {fetcher.data && fetcher.data.error && (
        <div className="mt-4">
          <AlertMessage variant="danger" message={fetcher.data.message} />
        </div>
      )}

      <FormActions>
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
      </FormActions>
    </div>
  );
};

export default CompanyForm;
