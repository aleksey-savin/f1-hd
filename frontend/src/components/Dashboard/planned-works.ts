/**
 * Раскладка своих плановых работ для главной — по срочности, а не по списку.
 *
 * - `today` — полоса «Сегодня в плане»: всё, что идёт или ещё будет сегодня, и
 *   всё, у чего время вышло, а подтверждения нет (за 14 дней). Неподтверждённая
 *   работа держит заявку открытой (`closeBlockers`), поэтому стоит рядом со
 *   срочным, а не пропадает вместе с прошедшим днём.
 * - `upcoming` — «Дальше в плане»: с завтра на 14 дней вперёд.
 *
 * Модуль чистый: «сейчас» и разницу в днях бизнес-пояса (`businessDaysAgo`)
 * передаёт вызывающий — так раскладка тестируется без браузера и пояса машины.
 */

export type PlannedWork = {
  _id: string;
  visitRequired: boolean;
  planningToStart: string;
  planningToFinish: string | null;
  tickets: { _id: string; num: number; title: string }[];
  company: { _id: string; alias: string } | null;
};

/**
 * - `unconfirmed` — время вышло, работу не подтвердили;
 * - `now` — идёт по плану;
 * - `soon` — ближайшая сегодняшняя, когда ничего не идёт;
 * - `later` — остальные сегодняшние.
 */
export type PlanPhase = "unconfirmed" | "now" | "soon" | "later";

export type TodayItem = {
  work: PlannedWork;
  phase: PlanPhase;
  /** Подсвеченная карточка: идущая, а без неё — ближайшая. */
  highlighted: boolean;
  /** Неподтверждённая с прошлого дня — у неё своя подпись дня. */
  pastDay: boolean;
};

export type UpcomingItem = { work: PlannedWork; daysAhead: number };

export const UNCONFIRMED_DAYS = 14;
export const UPCOMING_DAYS = 14;

const startOf = (work: PlannedWork) => new Date(work.planningToStart).getTime();
// Без конца плана работа «кончается» в момент начала
const endOf = (work: PlannedWork) =>
  new Date(work.planningToFinish ?? work.planningToStart).getTime();

export const splitPlan = (
  works: PlannedWork[],
  {
    now,
    daysAgo,
  }: {
    now: Date;
    /** Разница в календарных днях бизнес-пояса: сегодня → 0, вчера → 1. */
    daysAgo: (date: string) => number | null;
  },
) => {
  const moment = now.getTime();
  const sorted = [...works].sort((a, b) => startOf(a) - startOf(b));

  const today: TodayItem[] = [];
  const upcoming: UpcomingItem[] = [];

  for (const work of sorted) {
    const days = daysAgo(work.planningToStart);
    if (days === null) continue;
    const start = startOf(work);
    const end = endOf(work);

    if (start <= moment && moment < end) {
      today.push({ work, phase: "now", highlighted: true, pastDay: days > 0 });
    } else if (end <= moment) {
      if (days <= UNCONFIRMED_DAYS) {
        today.push({
          work,
          phase: "unconfirmed",
          highlighted: false,
          pastDay: days > 0,
        });
      }
    } else if (days === 0) {
      today.push({ work, phase: "later", highlighted: false, pastDay: false });
    } else if (days < 0 && -days <= UPCOMING_DAYS) {
      upcoming.push({ work, daysAhead: -days });
    }
  }

  // Ничего не идёт — подсвечиваем ближайшую сегодняшнюю
  if (!today.some((item) => item.phase === "now")) {
    const next = today.find((item) => item.phase === "later");
    if (next) {
      next.phase = "soon";
      next.highlighted = true;
    }
  }

  return { today, upcoming };
};

/** «через 45 мин», «через 2 ч 20 мин», «через 3 ч»; меньше минуты — «вот-вот». */
export const countdownText = (at: Date, now: Date) => {
  const diff = at.getTime() - now.getTime();
  if (diff < 60000) return "вот-вот";
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `через ${hours} ч ${rest} мин` : `через ${hours} ч`;
};
