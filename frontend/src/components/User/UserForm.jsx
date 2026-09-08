import { useContext, useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DateField from "@/components/app/DateField";
import Field from "@/components/app/Field";
import PasswordPolicyField from "@/components/app/PasswordPolicyField";
import RoleSummary, { effectiveOf, rolesToOptions } from "./RoleSummary";
import SwitchField from "@/components/app/SwitchField";
import Segmented from "@/components/app/Segmented";
import WizardStepper from "@/components/app/WizardStepper";
import AlertMessage from "@/components/app/AlertMessage";
import {
  FormHeader,
  FormSections,
  sectionAnchorId,
} from "@/components/app/FormLayout";
import { scrollToSection } from "@/components/app/AnchorRail";
import { OverlayScrollContext } from "@/components/app/overlay-context";
import { SubLabel } from "@/components/app/Panel";
import ScheduleEditor, {
  emptyDay,
  SCHEDULE_DAYS,
} from "@/components/app/ScheduleEditor";
import { cn } from "@/lib/utils";
import { verdictAllows } from "@/lib/password";
import { api } from "@/lib/api";

import Combobox, { MultiCombobox, toOptions } from "@/components/app/Combobox";
import { useFormSheet } from "@/components/app/FormOutlet";
import useInitialPrefs from "../../store/prefs";
import timezones from "../../store/timezones";
import { inheritedTimezone, tzCity } from "../../util/timezone-display";
import { businessDayKey } from "../../util/format-date";

import {
  ACCOUNT_KINDS,
  NOTIFY_EVENTS,
  WORK_TIME_MODES,
  kindOfUser,
  kindToFlags,
} from "./permissions-catalog";
import FormSummary from "./FormSummary";
import { useCan } from "@/store/authed-user";

// Форма пользователя: создание — визард со сводкой, правка — плоские секции
// (конвенция ux-ui-guide). Набор шагов зависит от типа аккаунта: клиенту не
// нужны права и категории, служебному — почти ничего. Тип аккаунта — один
// сегмент вместо трёх независимых флагов модели (isEndUser/isServiceAccount/
// isCloudTelephony); обратно в флаги собирается при сабмите.
const emptyNotify = () => ({
  byTelegram: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, true])),
  byEmail: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, true])),
});

/* ---------- график работы ---------- */
// График сотрудника правится ЗДЕСЬ, а не отдельным редактором на карточке:
// одно поле — одно место правки (docs/ux-ui-guide.md). Черновик собирается из
// самого пользователя (getOne отдаёт workSchedules/timezone/workTimeMode),
// поэтому форме не нужен запрос за графиком.
const DAY_KEYS = SCHEDULE_DAYS.map(([, key]) => key);

const MODE_HINT = {
  scheduled: "Статус меняется автоматически по графику, отсутствия — по заявке",
  free: "В календаре есть, но статусы ставит сам — любые, включая отпуск",
  none: "В календаре команды не показывается",
};

// «отчёты за май 2026» — именительный падеж: список в родительном («мая»)
// давал «отчёты за мая»
const MONTHS_NOMINATIVE = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

const workDay = () => ({ ...emptyDay(), isWorking: true, breakMinutes: 60 });

// Заготовка личного графика: 5/2 09:00–18:00 с часовым перерывом — та же, что
// DEFAULT_OVERTIME_SCHEDULE на бэкенде
const defaultWeek = () =>
  Object.fromEntries(
    DAY_KEYS.map((key, index) => [
      key,
      index < 5 ? workDay() : { ...emptyDay(), breakMinutes: 0 },
    ]),
  );

// «Сегодня» календарём организации, а не UTC: effectiveFrom — календарная дата,
// и toISOString() восточнее UTC до смены суток выбирал бы вчерашнюю версию
// графика (и подставлял вчерашнюю дату в новую).
const todayKey = () => businessDayKey();

// Действующая версия — последняя, начавшаяся не позже сегодняшнего дня
// (как её выбирает планировщик на бэкенде); версии без даты действуют всегда.
const activeVersion = (user) => {
  const versions = [...(user?.workSchedules || [])].sort((a, b) =>
    String(a.effectiveFrom ?? "").localeCompare(String(b.effectiveFrom ?? "")),
  );
  if (versions.length === 0) return null;
  const today = todayKey();
  const started = versions.filter(
    (version) =>
      !version.effectiveFrom ||
      String(version.effectiveFrom).slice(0, 10) <= today,
  );
  return started.at(-1) ?? versions[0];
};

const initialSchedule = (user) => {
  const version = activeVersion(user);
  const week = version?.schedule || user?.workSchedule || null;
  return {
    workTimeMode: user?.workTimeMode ?? "scheduled",
    remoteOnly: Boolean(user?.remoteOnly),
    timezone: user?.timezone || "",
    followProductionCalendar:
      version?.followProductionCalendar ??
      user?.followProductionCalendar ??
      true,
    week: week ? structuredClone(week) : defaultWeek(),
    hasPersonal: Boolean(week),
    // Новая версия по умолчанию не трогает прошлое
    effectiveFrom: todayKey(),
  };
};

const UserForm = () => {
  const {
    user,
    companiesList = [],
    categoriesList = [],
  } = useLoaderData() || {};
  const isEdit = !!user?._id;
  // Скроллится внутренность шторки, а не окно: переход к секции без этого
  // контекста не сдвинет ничего
  const scroller = useContext(OverlayScrollContext);

  const can = useCan();
  const canEditFinances = Boolean(can({ report: ["employees"] }));
  // Правка пользователя и правка графика — разные права. У кого есть только
  // второе (офис-менеджер, ведущий графики), форма открывается одной секцией
  // «График работы» и уходит своим endpoint'ом (см. pages/User/Update.jsx).
  const canManageUsers = Boolean(can({ user: ["manage"] }));
  const canManageSchedule = Boolean(can({ schedule: ["manage"] }));
  const { timezone: orgTimezone } = useInitialPrefs();

  const fetcher = useFetcher();
  const { close } = useFormSheet();

  // Тот же флаг, что гасит «Прислать письмо» на входе: notify.byEmail.isActive.
  const mailIsOn = Boolean(useInitialPrefs().emailNotifications);
  const [kind, setKind] = useState(kindOfUser(user));
  // Каталог ролей грузится формой: он нужен только на шаге прав и живёт
  // отдельно от списков, которые приходят загрузчиком страницы.
  const [catalogue, setCatalogue] = useState([]);
  // Вердикт по паролю живёт рядом с формой: шаг «Человек» не пускает дальше,
  // пока пароль не пройдёт те же проверки, что и на сервере.
  const [passwordVerdict, setPasswordVerdict] = useState({ kind: "idle" });
  const [form, setForm] = useState({
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    email: user?.email || "",
    phone: user?.phone || "",
    position: user?.position || "",
    password: "",
    // Как человек попадёт внутрь: "invite" — приглашение письмом (по
    // умолчанию: пароль не покидает голову владельца), "password" — задаём
    // сами. Почта выключена — остаётся только вторая дорога.
    access: "invite",
    isActive: !user?.banned,
    workStatusEnabled: user ? !user.hideWorkStatus : true,
    isCloudTelephony: !!user?.isCloudTelephony,
    isAdmin: !!user?.isAdmin,
    company: companiesList.find((c) => c._id === user?.company?._id) || null,
    subdivision: null,
    // Пусто = «как у подразделения»: копию не храним, переезд филиала
    // подхватится сам (каскад — services/clientTimezone)
    timezone: user?.timezone || null,
    categories: (user?.categories || [])
      .map((category) =>
        categoriesList.find((item) => item._id === category._id),
      )
      .filter(Boolean),
    responsibleForCompanies: (user?.responsibleForCompanies || [])
      .map((item) => companiesList.find((c) => c._id === String(item.id)))
      .filter(Boolean),
    // Права человека — это его роли; личных галочек не существует.
    // Сервер отдаёт роли парами ключ-название (их читает карточка); форме
    // нужны только ключи.
    roles: (user?.roles || []).map((role) => role.key || role),
    notify: user?.notify
      ? {
          byTelegram: {
            ...emptyNotify().byTelegram,
            ...user.notify.byTelegram,
          },
          byEmail: { ...emptyNotify().byEmail, ...user.notify.byEmail },
        }
      : emptyNotify(),
    finances: {
      salary: user?.finances?.salary ?? "",
      overtimeHourlyRate: user?.finances?.overtimeHourlyRate ?? "",
    },
    // Ключ PRO32 наружу не отдаётся (getOne маскирует в hasApi): поле всегда
    // пустое, пусто = «не менять», ввод = новый ключ
    getScreenApi: "",
  });
  const hasGetScreenKey = Boolean(user?.getScreen?.hasApi);
  // notify правит админ, но это личные настройки пользователя: шлём объект
  // только если его реально трогали, иначе сохранение затрёт чужой выбор.
  const [notifyDirty, setNotifyDirty] = useState(false);

  // График ведётся версиями: блок уходит на сервер, только если его трогали —
  // иначе правка телефона плодила бы версию с сегодняшней датой.
  const [schedule, setSchedule] = useState(() => initialSchedule(user));
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const patchSchedule = (patch) => {
    setScheduleDirty(true);
    setSchedule((current) => ({ ...current, ...patch }));
  };

  const setField = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  const subdivisions = form.company?.subdivisions || [];

  // Что подставится, если поле пояса оставить пустым
  const inheritedZone = inheritedTimezone({
    subdivision: form.subdivision,
    subdivisions,
    companyTimezone: form.company?.timezone,
  });

  // Подтягиваем сохранённое подразделение, когда список компаний уже известен
  useEffect(() => {
    if (!user?.subdivision) return;
    const id = String(user.subdivision?._id || user.subdivision);
    const found = subdivisions.find((s) => String(s._id) === id);
    if (found) setForm((prev) => ({ ...prev, subdivision: found }));
  }, [form.company]);

  const isService = kind === "service";
  const isStaff = kind === "staff";
  // Ключ PRO32 Connect — только у сотрудника: кнопка в заявке подключается
  // ключом того, кто её нажал (controllers/pro32Connect.js), клиент лишь
  // называет свою машину. Прежнее «при включённой интеграции — только у
  // клиентов» было наследием и показывало поле не тем.
  const canEditGetScreen = isStaff;

  /* ---------- шаги ---------- */
  // График — только у сотрудников (у клиента и служебного нет ни нормы часов,
  // ни отсутствий) и только с правом на графики
  const showSchedule = isStaff && canManageSchedule;
  // Финансы — только у сотрудника и только с правом на отчёт по сотрудникам
  const showFinances = canEditFinances && isStaff;
  // Секции те же и в том же порядке, что на карточке пользователя: сборной
  // «Дополнительно» нет — у каждого блока своё имя, и ярлык секции карточки
  // ведёт сюда хешем (update#finances, update#notifications)
  const stepKeys = canManageUsers
    ? [
        "person",
        "org",
        ...(showSchedule ? ["schedule"] : []),
        ...(showFinances ? ["finances"] : []),
        ...(isService ? [] : ["rights"]),
        ...(isService ? [] : ["notifications"]),
      ]
    : ["schedule"];
  const titles = {
    person: "Основное",
    org: "Организация",
    schedule: "График работы",
    finances: "Финансы",
    rights: "Права и доступ",
    notifications: "Уведомления",
  };
  const STEPS = stepKeys.map((key) => ({
    label: { rights: "Права", schedule: "График" }[key] ?? titles[key],
  }));
  const LAST = STEPS.length - 1;

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(isEdit ? 99 : 0);
  const [attempted, setAttempted] = useState(false);

  // Смена типа аккаунта может укоротить набор шагов — и снимает роли другого
  // адресата: селектор их больше не показывает, а невидимая роль всё равно
  // ушла бы на сервер. Пока каталог не загружен, адресата не узнать — не трогаем
  useEffect(() => {
    setStep((current) => Math.min(current, stepKeys.length - 1));
    if (!catalogue.length) return;
    const allowed = new Set(
      rolesToOptions(catalogue, kind).map((option) => option.value),
    );
    setForm((prev) =>
      prev.roles.every((key) => allowed.has(key))
        ? prev
        : { ...prev, roles: prev.roles.filter((key) => allowed.has(key)) },
    );
  }, [kind]);

  const stepError = (key) => {
    if (key === "person") {
      // Человеку обязательна только фамилия: имя бывает неизвестно (входящая
      // почта, справочник клиента). У служебной учётки наименование — это и
      // есть firstName, без него записи не назвать.
      if (isService && !form.firstName.trim()) return "Укажите наименование";
      if (!isService && !form.lastName.trim()) return "Укажите фамилию";
      if (!form.email.trim()) return "Укажите email";
      // Пароль требуется ТОЛЬКО на своей дороге: при приглашении его нет
      // вовсе, и это правильное состояние, а не незаполненное поле.
      if (!isEdit && !isService && form.access === "password") {
        if (!form.password.trim()) return "Задайте пароль";
        // Причина отказа уже написана под полем — сюда её не дублируем, иначе
        // человек читает одно и то же дважды и разными словами.
        if (!verdictAllows(passwordVerdict))
          return "Пароль не подходит — см. подсказку под полем";
      }
      return null;
    }
    if (key === "org" && !form.company) return "Выберите компанию";
    // Роль обязательна: без неё у человека нет прав, и «Далее»/«Сохранить»
    // не пускают дальше, пока не выбрана хотя бы одна
    if (key === "rights" && form.roles.length === 0) return "Выберите роль";
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

  const handleClose = () => close();

  // Липкая шапка формы закрывает верх колонки — рейл прижимается под неё
  const [headHeight, setHeadHeight] = useState(0);

  const saving = fetcher.state !== "idle";

  // Блок графика — тот же и в общем payload, и при правке одним графиком.
  // «Не ведётся» шлём одним полем: расписание не редактировалось, новую версию
  // плодить незачем — прежняя ждёт возврата учёта.
  const scheduleBlock = () =>
    schedule.workTimeMode === "none"
      ? { workTimeMode: "none" }
      : {
          workTimeMode: schedule.workTimeMode,
          remoteOnly: schedule.remoteOnly,
          timezone: schedule.timezone || null,
          followProductionCalendar: schedule.followProductionCalendar,
          schedule: schedule.week,
          effectiveFrom: schedule.effectiveFrom || null,
        };

  const handleSubmit = () => {
    // Форма открыта только на графике: остальных секций нет, и валидировать
    // нечего — уходим на endpoint графика
    if (!canManageUsers) {
      if (!scheduleDirty) return handleClose();
      fetcher.submit(
        { workSchedule: scheduleBlock() },
        { method: "post", encType: "application/json" },
      );
      return;
    }

    const badStep = stepKeys.findIndex((key) => stepError(key));
    if (badStep !== -1) {
      setAttempted(true);
      // Показать человеку незаполненное поле. В мастере это переключение шага,
      // в правке — прокрутка к секции: шагов там нет, и `setStep` молчал бы,
      // а форма выглядела бы сломанной — нажал «Сохранить», не случилось ничего
      if (isEdit) {
        scrollToSection(scroller, sectionAnchorId(stepKeys[badStep]));
      } else {
        setStep(badStep);
      }
      return;
    }

    const payload = {
      firstName: form.firstName.trim(),
      lastName: isService ? "" : form.lastName.trim(),
      email: form.email.trim(),
      phone: isService ? "" : form.phone,
      position: isService ? "" : form.position,
      ...kindToFlags(kind, { isCloudTelephony: form.isCloudTelephony }),
      // Форма говорит «Активен», база хранит обратное — переворачиваем здесь,
      // в единственной точке, а не заводим в интерфейсе слово «бан».
      banned: !form.isActive,
      hideWorkStatus: !form.workStatusEnabled,
      company: form.company?._id || null,
      subdivision: form.subdivision?._id || null,
      // У сотрудников пояс правится в карточке графика — оттуда и семантика
      // «как в организации»; здесь поле только для клиентов
      ...(isStaff ? {} : { timezone: form.timezone || null }),
      categories: isStaff ? form.categories.map((c) => c._id) : [],
      responsibleForCompanies: isStaff
        ? form.responsibleForCompanies.map((c) => ({
            id: c._id,
            alias: c.alias,
          }))
        : [],
      // Права даются ролями, и `isAdmin` сервер зеркалит из них сам
      // (services/roles.js#assign). Служебной учётке роли не положены —
      // сессий ей не выдают вовсе.
      roles: isService ? [] : form.roles,
    };

    if (!isEdit && !isService) {
      payload.access = form.access;
      // Пароль уходит только на своей дороге: при приглашении учётка заводится
      // вовсе без него.
      if (form.access === "password") payload.password = form.password;
    }
    if (canEditFinances && isStaff) {
      payload.finances = {
        salary:
          form.finances.salary === "" ? null : Number(form.finances.salary),
        overtimeHourlyRate:
          form.finances.overtimeHourlyRate === ""
            ? null
            : Number(form.finances.overtimeHourlyRate),
      };
    }
    // Пустое поле ключа не шлём — бэкенд трактует отсутствие как «не менять»
    if (canEditGetScreen && form.getScreenApi) {
      payload.getScreenApi = form.getScreenApi;
    }
    if (notifyDirty && !isService) payload.notify = form.notify;
    if (scheduleDirty && showSchedule) payload.workSchedule = scheduleBlock();

    fetcher.submit(payload, { method: "post", encType: "application/json" });
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      const id = fetcher.data.userId;
      close(id ? `/users/${id}` : "..", { replace: true });
    }
  }, [fetcher.state, fetcher.data]);

  // Каталог нужен и для выбора, и для блока «что получается». Право на чтение
  // есть у того, кто ведёт людей (routes/internal/role.js) — отдельной
  // проверки здесь не надо, отказ просто оставит список пустым.
  useEffect(() => {
    if (!canManageUsers) return;
    let alive = true;
    api("/api/roles")
      .then((data) => {
        if (alive) setCatalogue(Array.isArray(data.roles) ? data.roles : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canManageUsers]);

  /**
   * Новому клиенту роль подставляется сама: «Клиент» носят 665 человек из 696,
   * и заставлять выбирать её каждый раз значит требовать подтверждения того,
   * что и так верно. Сотруднику НЕ подставляется ничего — там выбор настоящий.
   *
   * Только при создании и только в пустое поле: правку чужого набора это
   * трогать не должно.
   */
  useEffect(() => {
    if (isEdit || kind !== "client" || form.roles.length || !catalogue.length) {
      return;
    }
    const plain = catalogue
      .filter((role) => role.audience === "client")
      .sort((a, b) => (b.usage?.total || 0) - (a.usage?.total || 0))[0];
    if (plain) setField("roles", [plain.key]);
  }, [catalogue, kind, isEdit]);

  /* ---------- переключатели ---------- */
  const toggleNotify = (channel, key) => {
    setNotifyDirty(true);
    setForm((prev) => ({
      ...prev,
      notify: {
        ...prev.notify,
        [channel]: {
          ...prev.notify[channel],
          [key]: !prev.notify[channel][key],
        },
      },
    }));
  };

  /**
   * Блок «Категории заявок» живёт только у исполнителя и только в форме
   * человека: у роли категорий нет, это свойство конкретной учётной записи.
   * Поэтому он приходит в общую матрицу пропом, а не переезжает в неё.
   */
  const categoriesUnderPerform = () => {
    if (!effectiveOf(form.roles, catalogue).sources["ticket.perform"]) {
      return null;
    }
    return (
      <div className="rounded-xl border border-border bg-accent p-3">
        <Field label="Категории заявок" htmlFor="u-categories">
          <MultiCombobox
            id="u-categories"
            placeholder="Выберите категории"
            value={(form.categories || []).map((item) => String(item._id))}
            options={toOptions(categoriesList, {
              value: (option) => String(option._id),
              label: (option) => option.title,
            })}
            onChange={(ids) =>
              setField(
                "categories",
                categoriesList.filter((option) =>
                  ids.includes(String(option._id)),
                ),
              )
            }
          />
        </Field>
        <div className="flex gap-4 text-sm font-semibold">
          <button
            type="button"
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-accent-text"
            onClick={() => setField("categories", categoriesList)}
          >
            Добавить все
          </button>
          <button
            type="button"
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-accent-text"
            onClick={() => setField("categories", [])}
          >
            Очистить
          </button>
        </div>
      </div>
    );
  };

  /* ---------- тела шагов ---------- */
  const workStatusSwitch = (
    <SwitchField
      id="u-workStatus"
      checked={form.workStatusEnabled}
      onCheckedChange={(value) => setField("workStatusEnabled", value)}
      label="Показывать в статусах присутствия"
      hint="Бар статусов и Telegram-табло."
      divider
    />
  );

  const personStep = (
    <>
      <Field
        label="Тип аккаунта"
        hint="Клиент обращается в поддержку, сотрудник её оказывает, служебный аккаунт входит только по API."
      >
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
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Фамилия" required htmlFor="u-lastName">
            <Input
              id="u-lastName"
              value={form.lastName}
              onChange={(event) => setField("lastName", event.target.value)}
            />
          </Field>
          <Field label="Имя" htmlFor="u-firstName">
            <Input
              id="u-firstName"
              value={form.firstName}
              onChange={(event) => setField("firstName", event.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
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
        <Field
          label="Как человек войдёт"
          className="mb-0"
          hint={
            mailIsOn
              ? undefined
              : "Почта в настройках выключена — письмо не уйдёт"
          }
        >
          <div className="flex flex-col gap-3.5">
            {/* Те же две дороги и тем же сегментом, что в диалоге пароля:
                один и тот же выбор не должен выглядеть в двух местах
                по-разному. Погашенная вкладка и есть сообщение, что дороги
                нет, — отдельного предупреждения рядом не нужно. */}
            <Segmented
              ariaLabel="Как человек войдёт"
              value={form.access}
              onChange={(value) => setField("access", value)}
              options={[
                {
                  value: "invite",
                  label: "Пригласить письмом",
                  disabled: !mailIsOn,
                  title: mailIsOn
                    ? undefined
                    : "Почта в настройках выключена — письмо не уйдёт",
                },
                { value: "password", label: "Задать пароль" },
              ]}
            />

            {form.access === "invite" ? (
              <p className="my-0 rounded-xl border border-border bg-accent/45 px-3 py-2.5 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {form.firstName || "Человек"} получит письмо со ссылкой.
                </span>{" "}
                Клиент войдёт по ней сразу, сотрудник задаст пароль. Вы пароль
                не увидите и передавать не придётся.
              </p>
            ) : (
              <>
                <PasswordPolicyField
                  id="u-password"
                  label="Пароль"
                  value={form.password}
                  onChange={(value) => setField("password", value)}
                  onVerdictChange={setPasswordVerdict}
                />
                <p className="my-0 text-sm text-muted-foreground">
                  Этот пароль придётся передать человеку самому — система его не
                  отправит.
                </p>
              </>
            )}
          </div>
        </Field>
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
        hint="Выключенный не сможет войти, а открытые сеансы завершатся."
        divider
      />

      {/* «Показывать в статусах присутствия» живёт в секции «График работы»:
          присутствие — одна тема, и разрывать её по двум секциям нельзя.
          Сотруднику без права на графики секции нет — тогда показываем здесь */}
      {isStaff && !showSchedule && workStatusSwitch}
    </>
  );

  const orgStep = (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Компания" required htmlFor="u-company">
          <Combobox
            id="u-company"
            placeholder="Выберите компанию"
            value={form.company?._id ? String(form.company._id) : null}
            options={toOptions(companiesList, {
              value: (option) => String(option._id),
              label: (option) => option.alias,
            })}
            onChange={(id) => {
              setField(
                "company",
                companiesList.find((option) => String(option._id) === id) ||
                  null,
              );
              setField("subdivision", null);
            }}
          />
        </Field>
        <Field label="Подразделение" htmlFor="u-subdivision">
          <Combobox
            id="u-subdivision"
            placeholder={
              form.company ? "Выберите подразделение" : "Сначала компания"
            }
            disabled={!form.company || subdivisions.length === 0}
            value={form.subdivision?._id ? String(form.subdivision._id) : null}
            options={toOptions(subdivisions, {
              value: (option) => String(option._id),
              label: (option) => option.name,
            })}
            onChange={(id) =>
              setField(
                "subdivision",
                subdivisions.find((option) => String(option._id) === id) ||
                  null,
              )
            }
            clearable
            clearLabel="Без подразделения"
          />
        </Field>
      </div>

      {!isStaff && (
        <Field
          label="Часовой пояс"
          hint={
            form.timezone
              ? "Где человек находится: по нему показывается местное время в заявках."
              : `Пусто — как у подразделения: ${tzCity(inheritedZone)}.`
          }
        >
          <Combobox
            id="u-timezone"
            placeholder={`Как у подразделения — ${tzCity(inheritedZone)}`}
            options={timezones}
            value={form.timezone}
            onChange={(value) => setField("timezone", value)}
            clearable
            clearLabel={`Как у подразделения — ${tzCity(inheritedZone)}`}
          />
        </Field>
      )}

      {isStaff && (
        <Field
          label="Ответственный за компании"
          htmlFor="u-responsible"
          hint="Определяет, чьи заявки и людей видит сотрудник."
        >
          <MultiCombobox
            id="u-responsible"
            placeholder="Выберите компании"
            value={(form.responsibleForCompanies || []).map((item) =>
              String(item._id),
            )}
            options={toOptions(companiesList, {
              value: (option) => String(option._id),
              label: (option) => option.alias,
            })}
            onChange={(ids) =>
              setField(
                "responsibleForCompanies",
                companiesList.filter((option) =>
                  ids.includes(String(option._id)),
                ),
              )
            }
          />
        </Field>
      )}

      {/* Ключ интеграции — среди полей организации, как строка «PRO32 Connect»
          в шапке карточки. Служебной учётке не нужен: она не открывает заявки */}
      {canEditGetScreen && (
        <Field
          label="API-ключ PRO32 Connect"
          htmlFor="u-getscreen"
          hint={
            hasGetScreenKey
              ? "Ключ задан и хранится в зашифрованном виде. Оставьте поле пустым, чтобы не менять; введённый ключ заменит текущий."
              : "Персональный ключ удалённого подключения — без него кнопка PRO32 Connect в заявке не работает."
          }
        >
          <Input
            id="u-getscreen"
            type="password"
            autoComplete="new-password"
            placeholder={hasGetScreenKey ? "••••••••  (ключ задан)" : ""}
            value={form.getScreenApi}
            onChange={(event) => setField("getScreenApi", event.target.value)}
          />
        </Field>
      )}
    </>
  );

  /* ---------- график работы ---------- */
  // Свободный режим: нормы и автостатусов нет, значит расписание, перерыв и
  // производственный календарь ни на что не влияют — в форме их быть не должно
  const isFreeMode = schedule.workTimeMode === "free";

  const currentBreak =
    Object.values(schedule.week ?? {}).find((day) => day.isWorking)
      ?.breakMinutes ?? 60;

  const setBreak = (value) => {
    const minutes = Math.max(0, Math.min(480, Number(value) || 0));
    patchSchedule({
      week: Object.fromEntries(
        Object.entries(schedule.week).map(([key, day]) => [
          key,
          day.isWorking ? { ...day, breakMinutes: minutes } : day,
        ]),
      ),
    });
  };

  const tzOptions = timezones.map((zone) => ({
    value: zone.value,
    label: zone.label,
  }));

  // Пояс, в котором читается график: личный, а если не выбран — организации
  const scheduleTzHint = (() => {
    const own = schedule.timezone || null;
    const effective = own || orgTimezone;
    if (!effective) return "часовой пояс организации";
    const label =
      tzOptions.find((zone) => zone.value === effective)?.label ?? effective;
    return own ? label : `${label}, как в организации`;
  })();

  // Сколько месяцев заденет правка задним числом — предупреждаем поимённо,
  // иначе согласованные суммы поедут молча
  const backdated = (() => {
    const from = schedule.effectiveFrom;
    if (!from) return null;
    const start = new Date(`${from}T00:00:00.000Z`);
    const now = new Date();
    if (start >= new Date(`${todayKey()}T00:00:00.000Z`)) return null;
    const months = [];
    const cursor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
    );
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    while (cursor <= last && months.length < 12) {
      months.push(
        `${MONTHS_NOMINATIVE[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`,
      );
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return months.join(", ");
  })();

  const scheduleStep = (
    <>
      <Field
        label="Учёт рабочего времени"
        hint={MODE_HINT[schedule.workTimeMode]}
      >
        <Segmented
          ariaLabel="Учёт рабочего времени"
          options={WORK_TIME_MODES}
          value={schedule.workTimeMode}
          onChange={(value) => patchSchedule({ workTimeMode: value })}
        />
      </Field>

      {/* «Не ведётся» — человека нет ни в календаре, ни в автоматике:
          расписание и всё, что от него зависит, показывать незачем */}
      {schedule.workTimeMode === "none" ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="mx-auto mb-0 max-w-md text-sm text-muted-foreground">
            Рабочее время не ведётся: сотрудник не показывается в календаре
            команды, статус по графику не меняется, заявки на отсутствие ему не
            нужны. Прежний график сохранится — если вернуть учёт, он снова
            заработает.
          </p>
        </div>
      ) : (
        <>
          <SwitchField
            id="u-remote-only"
            checked={schedule.remoteOnly}
            onCheckedChange={(value) =>
              patchSchedule({ remoteOnly: value === true })
            }
            label="Работает только удалённо"
            hint="Статуса «в офисе» у него не будет — автоматика поставит «на удалёнке»."
          />
          {workStatusSwitch}

          <div
            className={cn(
              "mt-4",
              isFreeMode ? "max-w-sm" : "grid gap-3 md:grid-cols-2",
            )}
          >
            <Field
              label="Часовой пояс"
              htmlFor="u-schedule-tz"
              hint={
                isFreeMode
                  ? "По нему показывается его местное время в календаре."
                  : "По нему считается его рабочий день — и в календаре, и в отчётах."
              }
            >
              <Combobox
                id="u-schedule-tz"
                options={tzOptions}
                value={schedule.timezone || null}
                onChange={(next) => patchSchedule({ timezone: next ?? "" })}
                placeholder="Как в организации"
                searchPlaceholder="Город или зона…"
                clearable
                clearLabel="Как в организации"
              />
            </Field>
            {!isFreeMode && (
              <Field
                label="Перерыв, мин"
                htmlFor="u-break"
                hint="Не входит в рабочее время; на часы влияет только в отчётах."
              >
                <Input
                  id="u-break"
                  inputMode="numeric"
                  value={currentBreak}
                  onChange={(event) => setBreak(event.target.value)}
                  className="tabular-nums"
                />
              </Field>
            )}
          </div>

          {!isFreeMode && (
            <SwitchField
              id="u-production-calendar"
              checked={schedule.followProductionCalendar}
              onCheckedChange={(value) =>
                patchSchedule({ followProductionCalendar: value === true })
              }
              label="Следовать производственному календарю РФ"
              hint="Праздники и перенесённые выходные становятся нерабочими, предпраздничные — короче на час."
              divider
            />
          )}

          <div className="mt-5 border-t border-border-soft pt-4">
            {!isFreeMode && <SubLabel>Недельный график</SubLabel>}
            <Field
              label="Действует с"
              htmlFor="u-effective-from"
              hint={
                isFreeMode
                  ? "С этой даты действует свободный режим; прежний график сохранится в истории."
                  : "Прежний график сохранится в истории и продолжит действовать до этой даты."
              }
            >
              <DateField
                id="u-effective-from"
                className="max-w-3xs"
                value={schedule.effectiveFrom}
                onChange={(next) => patchSchedule({ effectiveFrom: next })}
                clearable={false}
              />
            </Field>

            {/* Из самих полей «09:00–18:00» не видно, чьё это время: пояс
                у сотрудника свой, и по нему же считается его день */}
            {!isFreeMode && (
              <>
                <p className="mb-2 text-sm text-muted-foreground">
                  Время указывается по часовому поясу сотрудника —{" "}
                  <span className="font-medium text-foreground">
                    {scheduleTzHint}
                  </span>
                  . В календаре и отчётах у каждого свой день, поясá не
                  приводятся к общему.
                </p>
                <ScheduleEditor
                  schedule={schedule.week}
                  onChange={(week) => patchSchedule({ week })}
                />
              </>
            )}

            {!isFreeMode && backdated && (
              <div className="mt-4">
                <AlertMessage
                  variant="warning"
                  message={`Дата в прошлом: отчёты за ${backdated} пересчитаются по новому графику. Если месяц уже согласован, суммы в нём изменятся.`}
                />
              </div>
            )}
          </div>
        </>
      )}
    </>
  );

  // Клиенту каталог модулей не применим, но одно право у него штатное:
  // «все заявки своей компании» (директор, секретарь). Раньше секции у клиента
  // не было вовсе — и сохранение формы молча снимало это право.
  /**
   * Права и доступ = роли. Тип аккаунта решает, КТО человек, роль — что ему
   * можно; повторять здесь тип строкой нужно как раз затем, чтобы эти два
   * вопроса перестали читаться как две ступени одной раздачи прав.
   */
  const rightsStep = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-accent/45 px-3 py-2.5 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">
          {isStaff ? "Сотрудник" : "Клиент"}
        </span>
        <span>
          {isStaff ? "· оказывает поддержку" : "· обращается в поддержку"}
        </span>
        {/* В мастере тип живёт на первом шаге, в правке — в секции «Основное»
            того же скролла. Шаг там не переключается: состояние `step` в
            плоском режиме никто не читает, и кнопка молчала бы */}
        <button
          type="button"
          className="ml-auto cursor-pointer appearance-none border-0 bg-transparent p-0 text-sm font-semibold text-accent-text"
          onClick={() =>
            isEdit
              ? scrollToSection(scroller, sectionAnchorId("person"))
              : setStep(0)
          }
        >
          Изменить тип
        </button>
      </div>

      <Field
        label="Роли"
        htmlFor="u-roles"
        className="mb-0"
        hint="Права складываются: достаточно одной роли, которая даёт право."
      >
        <MultiCombobox
          id="u-roles"
          placeholder="Выберите роли"
          value={form.roles}
          options={rolesToOptions(catalogue, kind)}
          onChange={(keys) => setField("roles", keys)}
        />
      </Field>

      <RoleSummary
        roles={form.roles}
        catalogue={catalogue}
        emptyHint="Выберите хотя бы одну роль — без неё сохранить нельзя."
      />

      {categoriesUnderPerform()}
    </div>
  );

  const notificationsStep = (
    <>
      {notifyDirty && (
        <div className="mb-3">
          <AlertMessage
            variant="warning"
            message="Это личные настройки пользователя — при сохранении его выбор будет перезаписан."
          />
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-bold tracking-wide text-faint uppercase">
              <th className="p-3 text-left">Событие</th>
              <th className="p-3">Telegram</th>
              <th className="p-3">Email</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFY_EVENTS.filter((event) => !event.staffOnly || isStaff).map(
              (event) => (
                <tr key={event.key} className="border-t border-border-soft">
                  <td className="p-3 font-medium">{event.label}</td>
                  {["byTelegram", "byEmail"].map((channel) => (
                    <td key={channel} className="p-3">
                      <div className="flex justify-center">
                        <SwitchField
                          id={`n-${channel}-${event.key}`}
                          checked={!!form.notify[channel][event.key]}
                          onCheckedChange={() =>
                            toggleNotify(channel, event.key)
                          }
                          label=""
                          className="py-0"
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </>
  );

  const financesStep = (
    <div className="grid gap-3 md:grid-cols-2">
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
            setField("finances", {
              ...form.finances,
              salary: event.target.value,
            })
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
  );

  const bodyFor = (key) =>
    ({
      person: personStep,
      org: orgStep,
      schedule: scheduleStep,
      finances: financesStep,
      rights: rightsStep,
      notifications: notificationsStep,
    })[key];

  const subtitle = isEdit
    ? [
        `${user.lastName || ""} ${user.firstName || ""}`.trim(),
        user.company?.alias,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div>
      <FormHeader
        title={isEdit ? "Изменить пользователя" : "Новый пользователь"}
        subtitle={subtitle}
        onHeight={setHeadHeight}
      />

      {isEdit ? (
        /* Правка — плоские секции одним скроллом; слева рейл-якорь, как на
           карточке. Ярлык секции карточки ведёт сюда хешем (update#schedule) */
        <FormSections
          headHeight={headHeight}
          sections={stepKeys.map((key) => ({
            key,
            title: titles[key],
            /* Ошибка обязана быть видна и здесь: в мастере её показывает
               ветка ниже, а в плоской правке показать её больше некому */
            body: (
              <>
                {bodyFor(key)}
                {attempted && stepError(key) && (
                  <p className="mt-2 mb-0 text-sm text-destructive">
                    {stepError(key)}
                  </p>
                )}
              </>
            ),
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
          <div className="mt-6 flex flex-col gap-6 md:flex-row">
            <div className="min-w-0 flex-1">
              <h3 className="my-0 mb-4 text-base font-semibold tracking-tight">
                {titles[stepKeys[step]]}
              </h3>
              {bodyFor(stepKeys[step])}
              {attempted && stepError(stepKeys[step]) && (
                <p className="mt-2 mb-0 text-sm text-destructive">
                  {stepError(stepKeys[step])}
                </p>
              )}
            </div>
            <div className="md:w-72 md:flex-none">
              <FormSummary
                form={form}
                kind={kind}
                catalogue={catalogue}
                isEdit={isEdit}
                schedule={showSchedule && scheduleDirty ? schedule : null}
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

      {/* Ряд кнопок — как у app/FormWrapper: обе справа, без иконок */}
      <div className="sticky bottom-0 -mx-6 mt-6 flex items-center justify-end gap-2.5 bg-background px-6 py-3">
        <Button
          type="button"
          variant="ghost"
          onClick={handleClose}
          disabled={saving}
        >
          Отмена
        </Button>
        {isEdit ? (
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            Сохранить
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
                Назад
              </Button>
            )}
            {step < LAST && (
              <Button type="button" onClick={handleNext}>
                Далее
              </Button>
            )}
            {step === LAST && (
              <Button type="button" onClick={handleSubmit} disabled={saving}>
                {/* Кнопка называет ОБЕ половины действия: уходит письмо —
                    говорим об этом, не уходит — не обещаем. */}
                {isEdit
                  ? "Сохранить"
                  : isService || form.access === "password"
                    ? "Создать пользователя"
                    : "Создать и пригласить"}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default UserForm;
