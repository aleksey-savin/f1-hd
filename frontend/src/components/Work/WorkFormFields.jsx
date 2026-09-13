import { useState } from "react";

import { RiPencilLine, RiTimeLine, RiUserLine } from "react-icons/ri";

import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";
import Combobox, { MultiCombobox } from "@/components/app/Combobox";
import DateTimeField from "@/components/app/DateTimeField";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  businessDayKey,
  formatCalendarDate,
  formatDayKey,
  shiftLocalForm,
  toDateTimeLocal,
} from "../../util/format-date";

import OutOfSchedulePanel from "./OutOfSchedulePanel";
import { formatDurationWords } from "./duration";
import { formatWorkRange } from "./time-range";

// Чип называет результат («30 мин»), а не операцию («+30 мин»): инженер думает
// «работал полчаса», а не «прибавить тридцать к тому, что стоит».
//
// Отсчёт идёт НАЗАД ОТ ОКОНЧАНИЯ: работу отмечают после того, как её сделали,
// поэтому по умолчанию она только что закончилась. Вперёд от начала считаем
// только тогда, когда начало уже введено, а окончания ещё нет.
//
// Шкала — ЧЕТВЕРТИ ЧАСА, и это не про частоту ввода, а про арифметику:
// 15/30/45/60/90/120 дают целые доли часа (0,25 · 0,5 · 0,75 · 1 · 1,5 · 2), а
// десятки минут делятся на 3 с периодом (10 мин = 0,1(6) ч) — дальше по
// расчёту эти дроби вылезают кривыми цифрами. Пробовали набор по частоте
// (10/20/30/40/…): он точнее попадает в то, что вводят руками, и отвергнут
// ровно из-за этого. Дальше 2 часов чипы не идут: длиннее — 6,1 % работ, и это
// ровный хвост (2:30, 3:00, 4:00, 5:00, 8:00), который вводят руками.
const DURATION_CHIPS = [15, 30, 45, 60, 90, 120];

const TYPE_OPTIONS = [
  { value: "remote", label: "Удалённо" },
  { value: "onSite", label: "Выезд" },
];

// «Сейчас» — в строке подписи поля, акцентным текстом: у дальнего края поля
// кнопка-призрак терялась (макет «Время работы», вариант B)
const NowButton = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="cursor-pointer appearance-none rounded-sm border-0 bg-transparent p-0 text-sm leading-none font-semibold text-accent-text underline-offset-4 outline-none hover:underline focus-visible:ring-4 focus-visible:ring-ring/50"
  >
    Сейчас
  </button>
);

/**
 * Поля формы работы — одни на все режимы (`WORK_MODES` в use-work-form).
 * Разметка без формы и футера: сабмит у маршрутных форм карточки и у шторки
 * массового добавления разный, а поля обязаны совпадать.
 *
 * @param {Object} form состояние из useWorkForm
 * @param {Array} performers кандидаты в исполнители
 * @param {Array} otherTickets заявки-кандидаты для «Связанных заявок»
 * @param {boolean} canPickPerformer выбирать исполнителя вправе администратор
 * @param {string|null} limitWorksDateFrom дата, раньше которой период закрыт отчётом
 */
const WorkFormFields = ({
  form,
  performers = [],
  otherTickets = [],
  canPickPerformer = false,
  limitWorksDateFrom = null,
}) => {
  const {
    config,
    isPlan,
    visitRequired,
    setVisitRequired,
    description,
    setDescription,
    startedAt,
    setStartedAt,
    finishedAt,
    setFinishedAt,
    performerId,
    setPerformerId,
    linkedTicketIds,
    setLinkedTicketIds,
    withinPlan,
    setWithinPlan,
    durationMs,
    isReversed,
    isLong,
    preview,
    isPreviewLoading,
    isPreviewError,
    retryPreview,
  } = form;

  // Поля начала и окончания — по запросу: обычно работу отмечают сразу после
  // неё (86–89% заканчиваются в пределах 10 минут от внесения), и хватает
  // чипа. Открыты сразу там, где время вводят или правят: план и уже
  // записанная работа (изменение, подтверждение).
  const [timeFieldsOpen, setTimeFieldsOpen] = useState(
    () => isPlan || Boolean(startedAt || finishedAt),
  );
  const timeRange = formatWorkRange(startedAt, finishedAt, {
    today: businessDayKey(),
    formatDay: formatDayKey,
  });

  const minStart = limitWorksDateFrom
    ? toDateTimeLocal(limitWorksDateFrom)
    : "";
  const performerLabel = isPlan ? "Исполнитель" : "Кто выполнил";
  const performer = performers.find(
    (person) => String(person._id) === String(performerId),
  );

  const setDuration = (minutes) => {
    // Окончание уже стоит — двигаем начало назад, окончание не трогаем
    if (finishedAt) {
      setStartedAt(shiftLocalForm(finishedAt, -minutes));
      return;
    }

    // Введено только начало — считаем вперёд от него
    if (startedAt) {
      setFinishedAt(shiftLocalForm(startedAt, minutes));
      return;
    }

    // Пустая форма: работа только что закончилась
    const now = toDateTimeLocal();
    setFinishedAt(now);
    setStartedAt(shiftLocalForm(now, -minutes));
  };

  const activeChip =
    durationMs != null && durationMs > 0 ? durationMs / 60000 : null;

  return (
    <div className="flex flex-col">
      <Field label="Тип работы">
        <Segmented
          ariaLabel="Тип работы"
          options={TYPE_OPTIONS}
          value={visitRequired ? "onSite" : "remote"}
          onChange={(value) => setVisitRequired(value === "onSite")}
          className="w-fit"
        />
      </Field>

      <Field
        label={config.descriptionLabel}
        htmlFor="work-description"
        required={config.descriptionRequired}
        hint={
          isPlan
            ? "Необязательно — можно дописать при подтверждении."
            : "Текст попадёт в отчёт клиенту."
        }
      >
        <Textarea
          id="work-description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <div className="mb-4">
        <div className="flex items-baseline gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            {isPlan ? "Планируемое время" : "Время работы"}
            <span className="text-destructive">*</span>
          </span>
          <span
            className={cn(
              "ml-auto text-lg font-semibold tabular-nums",
              isReversed && "text-destructive",
            )}
          >
            {durationMs == null || isReversed
              ? "—"
              : formatDurationWords(durationMs / 60000)}
          </span>
        </div>

        {/* Чипы — основной способ задать длительность, поэтому размер обычной
            кнопки, а не мелкой: по ним целятся мышью и пальцем чаще, чем
            правят время руками */}
        <div className="mt-2.5 flex flex-wrap gap-2">
          {DURATION_CHIPS.map((minutes) => (
            <Button
              key={minutes}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDuration(minutes)}
              className={cn(
                "rounded-full px-4",
                activeChip === minutes &&
                  "border-primary bg-primary/10 font-semibold text-accent-text",
              )}
            >
              {formatDurationWords(minutes)}
            </Button>
          ))}
        </div>

        {isLong && !isReversed && (
          <p className="mt-2 mb-0 flex items-center gap-1.5 text-xs text-warning">
            <RiTimeLine size={14} /> Дольше 12 часов — проверьте время.
          </p>
        )}

        {/* Выбранное время — фразой, которую проверяют взглядом; поля — по
            запросу */}
        {!timeFieldsOpen && (
          <div className="mt-2.5 flex min-h-9 flex-wrap items-center gap-x-1">
            {timeRange && (
              <span className="me-1 text-sm tabular-nums">{timeRange}</span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ms-2.5"
              onClick={() => setTimeFieldsOpen(true)}
            >
              <RiPencilLine />
              {timeRange ? "Изменить время" : "Указать вручную"}
            </Button>
          </div>
        )}
      </div>

      {timeFieldsOpen && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label={isPlan ? "Планируемое начало" : "Начало"}
            htmlFor="work-started-at"
            aside={<NowButton onClick={() => setStartedAt(toDateTimeLocal())} />}
            hint={
              minStart
                ? `Отчёт по услуге сформирован — работы можно указывать с ${formatCalendarDate(limitWorksDateFrom)}.`
                : undefined
            }
          >
            <DateTimeField
              id="work-started-at"
              value={startedAt}
              min={minStart || undefined}
              onChange={setStartedAt}
            />
          </Field>

          <Field
            label={isPlan ? "Планируемое окончание" : "Окончание"}
            htmlFor="work-finished-at"
            aside={
              <NowButton onClick={() => setFinishedAt(toDateTimeLocal())} />
            }
            hint={
              isReversed ? (
                <span className="text-destructive">
                  Окончание раньше начала.
                </span>
              ) : undefined
            }
          >
            <DateTimeField
              id="work-finished-at"
              value={finishedAt}
              min={startedAt || minStart || undefined}
              onChange={setFinishedAt}
              invalid={isReversed}
            />
          </Field>
        </div>
      )}

      <div className="mb-4">
        <OutOfSchedulePanel
          preview={preview}
          isLoading={isPreviewLoading}
          isError={isPreviewError}
          onRetry={retryPreview}
          withinPlan={withinPlan}
          onWithinPlanChange={setWithinPlan}
        />
      </div>

      {canPickPerformer ? (
        <Field label={performerLabel} htmlFor="work-performer" required>
          <div className="flex gap-2">
            <Combobox
              id="work-performer"
              value={performerId || null}
              options={performers.map((person) => ({
                value: String(person._id),
                label: `${person.lastName} ${person.firstName}`,
                hint: person.position || undefined,
              }))}
              onChange={(value) => setPerformerId(value ?? "")}
              placeholder="Выберите сотрудника"
              className="min-w-0 flex-1"
            />
          </div>
        </Field>
      ) : (
        // Исполнителя всё равно проставит сервер — интерфейс это произносит,
        // а не молчит
        <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <RiUserLine size={15} className="text-faint" />
          {performerLabel} ·{" "}
          <span className="font-medium text-foreground">
            {performer ? `${performer.lastName} ${performer.firstName}` : "Вы"}
          </span>
        </p>
      )}

      {config.linkTickets && otherTickets.length > 0 && (
        <Field
          label="Связанные заявки"
          htmlFor="work-linked-tickets"
          hint="Работа будет учтена и в этих заявках."
        >
          <MultiCombobox
            id="work-linked-tickets"
            value={linkedTicketIds}
            options={otherTickets.map((ticket) => ({
              value: String(ticket._id),
              label: `№${ticket.num} · ${ticket.title}`,
            }))}
            onChange={setLinkedTicketIds}
            placeholder="Найти заявку…"
          />
        </Field>
      )}
    </div>
  );
};

export default WorkFormFields;
