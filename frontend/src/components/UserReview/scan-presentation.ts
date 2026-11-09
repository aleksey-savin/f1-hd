import type { ReviewScan } from "@/types/userReview";

const number = new Intl.NumberFormat("ru-RU");
const decimal = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
export const scanNumber = (value: number): string => number.format(value);

export const scanPercent = (settled: number, total: number) => {
  const value = total > 0 ? Math.min((settled / total) * 100, 100) : 0;
  const label =
    value > 0 && value < 0.1
      ? "< 0,1 %"
      : `${decimal.format(Math.floor(value * 10) / 10)} %`;
  return { value, label };
};

export const scanElapsed = (startedAt: string | null, now: number) => {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

type ScanAction = {
  intent: "scan" | "resume" | "pause";
  label: string;
};
type StepState = "waiting" | "running" | "done";

const leaseIsLive = (until: string | null | undefined, now: number) =>
  Boolean(until && Date.parse(until) > now);

/** Локальные часы нужны только до конца подтверждённой сервером аренды. */
export const scanClockActive = (
  scan: ReviewScan | null | undefined,
  now: number,
) =>
  Boolean(
    scan &&
      scan.phase !== "disabled" &&
      (leaseIsLive(scan.active?.leaseUntil, now) ||
        (scan.phase === "discovering" &&
          leaseIsLive(scan.discoveryLeaseUntil, now))),
  );

export function scanPresentation(
  scan: ReviewScan,
  paused: boolean,
  now = Date.now(),
) {
  const disabled = scan.phase === "disabled";
  const active =
    !disabled && leaseIsLive(scan.active?.leaseUntil, now) ? scan.active : null;
  const discovering =
    !disabled &&
    scan.phase === "discovering" &&
    leaseIsLive(scan.discoveryLeaseUntil, now);
  const busy = discovering || active !== null;
  const stopping = paused && active?.inSnapshot === true;
  const finished = scan.phase === "done" || scan.phase === "errors";
  const snapshotFinished =
    scan.hasRun && scan.discoveryComplete && scan.remaining === 0;
  const incremental = active?.inSnapshot === false;
  let title: string;
  let description: string;
  let action: ScanAction | null = null;

  if (disabled) {
    title = "Проверка истории недоступна";
    description =
      "Для анализа текста включите проверку пользователей и подключение к ИИ в настройках системы.";
  } else if (stopping) {
    title = "Останавливаем после текущей заявки";
    description =
      "Текущая заявка завершится. Остальные заявки из истории останутся в очереди; проверку можно будет продолжить с того же места.";
  } else if (active) {
    title = incremental
      ? "Проверяем отдельную заявку"
      : active.stage === "ai"
        ? "Уточняем основание по заявке"
        : "Проверяем историю заявок";
    description = incremental
      ? "Новые и изменённые заявки проверяются отдельно от истории. Их обработка не меняет прогресс проверки истории."
      : active.stage === "ai"
        ? "ИИ уточняет, о ком идёт речь и какие изменения доступа и ограничения описаны в заявке."
        : "Проверяем текст заявки и комментариев на увольнения, возвращение сотрудников и изменение доступа.";
  } else if (discovering) {
    title = "Собираем заявки для проверки";
    description =
      "Открываем историю и комментарии. Первые результаты появятся по мере обработки.";
  } else if (scan.hasRun && !finished && (paused || scan.phase === "paused")) {
    title = "Проверка истории на паузе";
    description =
      "Результаты сохранены. Продолжим с того же места, когда вы нажмёте «Продолжить проверку».";
  } else if (scan.phase === "done") {
    title = scan.total > 0 ? "История проверена" : "Нет заявок для проверки";
    description =
      scan.total > 0
        ? "Найденные основания доступны в проверке пользователей. Отключение и удаление подтверждает сотрудник."
        : "В доступной истории нет заявок для проверки.";
  } else if (scan.phase === "errors") {
    title = "Проверка завершена с ошибками";
    description =
      "Часть заявок не удалось проверить. Откройте список ошибок ниже и повторите проверку.";
  } else if (!scan.hasRun) {
    title =
      scan.availableTotal > 0
        ? "История ещё не проверялась"
        : "Нет заявок для проверки";
    description =
      scan.availableTotal > 0
        ? `Можно проверить ${scanNumber(scan.availableTotal)} заявок.`
        : "В доступной истории нет заявок для проверки.";
  } else {
    title = "Ожидаем следующую порцию";
    if (scan.pending === 0 && scan.processing === 0 && scan.notDiscovered > 0) {
      const cadence =
        scan.cadence.discoverySeconds === 300
          ? "раз в 5 минут"
          : `каждые ${scanNumber(scan.cadence.discoverySeconds)} с`;
      description = `Следующая порция истории добавляется ${cadence}. Проверка продолжится в фоне; страницу можно закрыть.`;
    } else {
      const cadence =
        scan.cadence.analysisSeconds === 60
          ? "раз в минуту"
          : `каждые ${scanNumber(scan.cadence.analysisSeconds)} с`;
      description = `Проверка идёт в фоне, порциями. Обработчик запускается ${cadence}; страницу можно закрыть.`;
    }
  }

  if (!disabled && !stopping) {
    if (!scan.hasRun && scan.availableTotal > 0) {
      action = { intent: "scan", label: "Начать проверку истории" };
    } else if (
      !finished &&
      !snapshotFinished &&
      (paused || scan.phase === "paused")
    ) {
      action = { intent: "resume", label: "Продолжить проверку" };
    } else if (scan.hasRun && !finished && !snapshotFinished) {
      action = { intent: "pause", label: "Приостановить" };
    }
  }

  const percent = scanPercent(scan.settled, scan.total);
  const progress =
    scan.hasRun && scan.total > 0
      ? {
          settled: scan.settled,
          checked: scan.checked,
          errors: scan.errors,
          total: scan.total,
          percent: percent.value,
          percentLabel: percent.label,
        }
      : null;
  const discoveryState: StepState =
    scan.hasRun && scan.discoveryComplete
      ? "done"
      : discovering
        ? "running"
        : "waiting";
  const checkingState: StepState = snapshotFinished
    ? "done"
    : scan.hasRun && active?.inSnapshot
      ? "running"
      : "waiting";
  return {
    title,
    description,
    busy,
    active,
    stopping,
    action,
    progress,
    showResults: scan.checked > 0 || finished,
    steps: [
      {
        label: "Просмотр истории",
        state: discoveryState,
        description:
          scan.hasRun && scan.discovered > 0
            ? `${scanNumber(scan.discovered)} из ${scanNumber(scan.total)} заявок взяты для проверки`
            : "Заявки и комментарии из истории обращений",
      },
      {
        label: "Проверка текстов",
        state: checkingState,
        description:
          scan.hasRun && scan.settled > 0
            ? `${scanNumber(scan.checked)} проверено${scan.errors > 0 ? `, ${scanNumber(scan.errors)} с ошибками` : ""}`
            : "Признаки проверяются без ИИ; подходящий контекст разбирается моделью",
      },
      {
        label: "Результаты",
        state: snapshotFinished ? ("done" as const) : ("waiting" as const),
        description:
          "Основания для решений по учётным записям — в проверке пользователей",
      },
    ],
  };
}
