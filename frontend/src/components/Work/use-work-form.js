import { useEffect, useMemo, useRef, useState } from "react";

import { localToUtc, utcToLocalForm } from "../../util/format-date";
import { getLocalStorageData } from "../../util/auth";

import { LONG_WORK_MS } from "./duration";

/**
 * Состояние формы работы: поля, длительность, валидация и предварительный
 * расчёт доплаты.
 *
 * Живёт отдельно от разметки, потому что разметку делят два разных хоста:
 * маршрутные формы карточки заявки (сабмит через router-action) и шторка
 * массового добавления из списка заявок (императивный запрос). Форма у них
 * одна, а способ отправки разный — состояние общее, футер свой.
 *
 * Расчёт доплаты не считается здесь: его отдаёт `POST /api/works/preview`, а
 * там его делает тот же код, что выставляет счёт. Запрос уходит с задержкой
 * после правки времени; ответ старого набора не перетирает свежий (seq-guard,
 * как в сторах отчётов).
 */

const PREVIEW_DELAY = 400;

/** Режимы формы: чем отличается набор полей и куда уходят отметки времени. */
export const WORK_MODES = {
  add: {
    title: "Новая работа",
    time: "fact",
    descriptionLabel: "Что сделано",
    descriptionRequired: true,
    linkTickets: true,
  },
  update: {
    title: "Изменить работу",
    time: "fact",
    descriptionLabel: "Что сделано",
    descriptionRequired: true,
    linkTickets: true,
  },
  schedule: {
    title: "Запланировать работу",
    time: "plan",
    descriptionLabel: "Что нужно сделать",
    descriptionRequired: false,
    linkTickets: true,
  },
  updateScheduled: {
    title: "Изменить запланированную работу",
    time: "plan",
    descriptionLabel: "Что нужно сделать",
    descriptionRequired: false,
    linkTickets: true,
  },
  confirm: {
    title: "Подтвердить выполнение",
    time: "fact",
    descriptionLabel: "Что сделано",
    descriptionRequired: true,
    linkTickets: true,
  },
  bulk: {
    title: "Новая работа",
    time: "fact",
    descriptionLabel: "Что сделано",
    descriptionRequired: true,
    linkTickets: false,
  },
};

const toForm = (value) => (value ? utcToLocalForm(value) : "");

/**
 * @param {Object} input
 * @param {keyof WORK_MODES} input.mode
 * @param {Object|null} input.work правимая работа (null при создании)
 * @param {string[]} input.ticketIds заявки, к которым привязывается работа
 * @param {string} input.currentUserId
 */
export const useWorkForm = ({ mode, work = null, ticketIds, currentUserId }) => {
  const config = WORK_MODES[mode];
  const isPlan = config.time === "plan";

  const [visitRequired, setVisitRequired] = useState(
    work?.visitRequired ?? false,
  );
  const [description, setDescription] = useState(work?.description ?? "");
  const [withinPlan, setWithinPlan] = useState(work?.withinPlan ?? false);

  // При подтверждении факт предзаполняется плановым временем — его и правят,
  // если работали иначе
  const [startedAt, setStartedAt] = useState(() => {
    if (mode === "confirm") return toForm(work?.planningToStart);
    return toForm(isPlan ? work?.planningToStart : work?.startedAt);
  });
  const [finishedAt, setFinishedAt] = useState(() => {
    if (mode === "confirm") return toForm(work?.planningToFinish);
    return toForm(isPlan ? work?.planningToFinish : work?.finishedAt);
  });

  const [performerId, setPerformerId] = useState(() => {
    const person = isPlan ? work?.executor : work?.finishedBy;
    return person?._id ? String(person._id) : String(currentUserId ?? "");
  });

  // Уже привязанные заявки берём из work.linkedTickets (бэкенд резолвит все
  // связи работы), а не фильтром по кандидатному списку: иначе связь с заявкой
  // вне него не показалась бы и потерялась при сохранении
  const [linkedTicketIds, setLinkedTicketIds] = useState(() =>
    (work?.linkedTickets || [])
      .map((linked) => String(linked._id))
      .filter((id) => !ticketIds.includes(id)),
  );

  const durationMs = useMemo(() => {
    if (!startedAt || !finishedAt) return null;
    return new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  }, [startedAt, finishedAt]);

  const isReversed = durationMs != null && durationMs < 0;
  const isLong = durationMs != null && durationMs > LONG_WORK_MS;

  const isValid =
    Boolean(startedAt) &&
    Boolean(finishedAt) &&
    !isReversed &&
    (!config.descriptionRequired || description.trim().length > 0) &&
    Boolean(performerId);

  /* ── Предварительный расчёт ─────────────────────────────────────────── */

  // Зависимость эффекта — СТРОКА, а не массив: `ticketIds` приходит литералом
  // и пересоздаётся на каждый рендер, из-за чего эффект перезапускался сам от
  // себя (setPreviewState → рендер → новая ссылка → эффект) и блок мерцал,
  // непрерывно дёргая бэкенд.
  const ticketsKey = [...new Set([...ticketIds, ...linkedTicketIds])].join(",");
  const allTicketIds = useMemo(
    () => ticketsKey.split(",").filter(Boolean),
    [ticketsKey],
  );

  const [preview, setPreview] = useState(null);
  const [previewState, setPreviewState] = useState("idle");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!startedAt || !finishedAt || isReversed || allTicketIds.length === 0) {
      setPreview(null);
      setPreviewState("idle");
      return undefined;
    }

    const attempt = ++seq.current;
    setPreviewState("loading");

    const timer = setTimeout(async () => {
      try {
        const { token } = getLocalStorageData();
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/works/preview`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({
              tickets: allTicketIds,
              startedAt: localToUtc(startedAt),
              finishedAt: localToUtc(finishedAt),
            }),
          },
        );

        if (!response.ok) throw new Error("preview failed");
        const data = await response.json();

        // Поздний ответ прошлого набора не перетирает свежий
        if (attempt !== seq.current) return;
        setPreview(data);
        setPreviewState("idle");
      } catch {
        if (attempt !== seq.current) return;
        // Сумма нигде не хранится — её посчитает отчёт, поэтому неудачный
        // расчёт сохранение не блокирует, а только объясняется в блоке
        setPreviewState("error");
      }
    }, PREVIEW_DELAY);

    return () => clearTimeout(timer);
  }, [startedAt, finishedAt, isReversed, ticketsKey, previewAttempt]);

  // Льготную категорию решает сервер (и при сохранении тоже) — переключатель
  // при ней не показывается, но значение должно уйти согласованным
  const effectiveWithinPlan = preview?.alwaysWithinPlan ? true : withinPlan;

  const buildPayload = () => {
    const times = isPlan
      ? {
          scheduled: true,
          planningToStart: localToUtc(startedAt),
          planningToFinish: localToUtc(finishedAt),
        }
      : {
          startedAt: localToUtc(startedAt),
          finishedAt: localToUtc(finishedAt),
        };

    return {
      tickets: allTicketIds,
      description: description.trim(),
      visitRequired,
      withinPlan: effectiveWithinPlan,
      ...times,
      ...(isPlan ? { executor: performerId } : { finishedBy: performerId }),
    };
  };

  return {
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

    withinPlan: effectiveWithinPlan,
    setWithinPlan,

    durationMs,
    isReversed,
    isLong,
    isValid,

    preview,
    isPreviewLoading: previewState === "loading",
    isPreviewError: previewState === "error",
    retryPreview: () => setPreviewAttempt((value) => value + 1),

    buildPayload,
  };
};
