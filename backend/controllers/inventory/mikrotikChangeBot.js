// Запросы ИИ-агентов на изменение Mikrotik: ручки бота Telegram (кнопки решения).
// Бот не хранит ни текст, ни решение — спрашивает здесь. Решает тот же сервис, что и портал (changeDecisions).
//
// Два правила этого файла:
//   1) решает только тот, чей шаг текущий (проверка здесь и ещё раз, атомарно, в сервисе решений);
//   2) утвердить из Telegram можно только то, что Telegram показал целиком.
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");

const { AppError } = require("../../middleware/errorHandling");
const { MESSAGES } = require("../../services/mikrotik/changeDecisions");
const { STATUS, STATUS_LABELS, currentStep } = require("../../services/mikrotik/changeSteps");
const { stepMessage, stepKeyboard, confirmText, confirmFull, confirmKeyboard } = require("../../services/mikrotik/changeNotifications");

const NOT_FITS = "Команды не помещаются в сообщение";
const idOf = (v) => (v && typeof v === "object" && "_id" in v ? String(v._id) : v == null ? "" : String(v));
const nameOf = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 80);

// Отказ всегда HTTP 200: бот показывает message алертом и по code решает, убирать ли кнопки
const refuse = (res, code, message) => res.status(200).json({ ok: false, code, message: message || MESSAGES[code] });

// Тот же порядок проверок, что в changeSteps.decide: закрыт → истёк → не ваш шаг.
// Свой уже решённый шаг идёт первым: человек должен узнать, прошло ли его решение (ответ мог потеряться).
// Не участнику запроса состояние не сообщаем вовсе: для него любой запрос «не за вами».
function gate(change, userId, now) {
  if (!change) return "not_found";
  const steps = change.steps || [];
  if (!steps.some((s) => idOf(s.user) === String(userId))) return "not_yours";
  const mine = steps.some((s) => idOf(s.user) === String(userId) && s.decision);
  if (mine) return "already_yours";
  const step = currentStep(change);
  if (!step) return "closed";
  const expiresAt = change.expiresAt ? new Date(change.expiresAt).getTime() : NaN;
  if (!(now.getTime() < expiresAt)) return "expired";
  if (idOf(step.user) !== String(userId)) return "not_yours";
  return null;
}

// «Вы уже утвердили запрос № 7. Запрос применяется.» — свой исход и состояние сейчас
function ownOutcome(change, userId, users) {
  const steps = change.steps || [];
  const index = steps.findIndex((s) => idOf(s.user) === String(userId) && s.decision);
  const word = steps[index].decision === "reject" ? "отклонили" : index < steps.length - 1 ? "подтвердили" : "утвердили";
  let state;
  if (change.status === STATUS.awaitingRequester || change.status === STATUS.awaitingResponsible) {
    const next = currentStep(change);
    const who = next && nameOf(users?.get?.(idOf(next.user)));
    state = who ? `Дальше решает ${who}.` : "Запрос ждёт решения.";
  } else if (change.status === STATUS.queued || change.status === STATUS.applying) state = "Запрос применяется.";
  else if (change.status === STATUS.applied) state = "Запрос применён.";
  else if (change.status === STATUS.rejected) state = "Запрос отклонён.";
  else state = `${STATUS_LABELS[change.status] || change.status}.`;
  return `Вы уже ${word} запрос. ${state}`;
}

// Лимит нажатий на человека, до общего лимитера бота: всплеск одного не должен глушить остальные вызовы бота
const actorKey = (req) => `tg-actor:${req.get("x-tg-actor") || "none"}`;
const createActorLimiter = ({ max = 30 } = {}) =>
  rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: actorKey,
    handler: (req, res) => res.status(429).json({ message: "Слишком много нажатий. Подождите минуту." }),
  });

function createBotHandlers({ load, loadContext, decisions, baseUrl = "", now = () => new Date(), log }) {
  const wrap = (label, fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error instanceof AppError ? error : new AppError(`Failed to ${label}`, 500, true, error));
    }
  };
  const find = async (id) => (mongoose.isValidObjectId(id) ? load(id) : null);

  async function refuseGate(res, change, req, code) {
    if (code !== "already_yours") return refuse(res, code);
    let users;
    try { users = (await loadContext(change)).users; } catch { /* без имени — общая фраза */ }
    return refuse(res, code, ownOutcome(change, req.userId, users));
  }

  // Что бот покажет сейчас. Не влезло — ни кнопок решения, ни шага подтверждения.
  function present(change, ctx) {
    const { text, fits } = stepMessage(change, ctx);
    const full = fits ? confirmFull(change, ctx) : null;
    const shows = fits && full !== null;
    return {
      text,
      keyboard: stepKeyboard(change, shows, { baseUrl }) || null,
      confirmText: shows ? confirmText(change, ctx) : null,
      confirmFull: full && shows ? full : null,
      confirmKeyboard: shows ? confirmKeyboard(change) : null,
      shows,
    };
  }

  const message = wrap("show mikrotik change", async (req, res) => {
    const change = await find(req.params.id);
    const code = gate(change, req.userId, now());
    if (code) return refuseGate(res, change, req, code);
    const { shows: _shows, ...view } = present(change, await loadContext(change));
    res.status(200).json({ ok: true, ...view });
  });

  const decision = wrap("decide mikrotik change", async (req, res) => {
    const kind = req.body?.decision;
    if (kind !== "approve" && kind !== "reject") throw new AppError("decision must be approve or reject", 400);

    const change = await find(req.params.id);
    const code = gate(change, req.userId, now());
    if (code) return refuseGate(res, change, req, code);

    let ctx = null;
    if (kind === "approve") {
      ctx = await loadContext(change);
      if (!present(change, ctx).shows) return refuse(res, "too_long", `${NOT_FITS} — утвердите запрос в HD`);
    }

    const result = await decisions.decide({
      changeId: req.params.id,
      userId: req.userId,
      decision: kind,
      comment: undefined,
      channel: "telegram",
      canApprove: Boolean(req.auth?.can?.({ mikrotik: ["approveChanges"] })),
    });
    if (!result.ok) return refuse(res, result.code, result.message);

    // Решение уже записано: сбой в тексте ответа его не отменяет
    const n = change.number;
    let text = kind === "reject" ? "Вы отклонили запрос." : "Вы подтвердили запрос.";
    try {
      if (kind === "approve") {
        if (result.change.status === STATUS.queued) {
          text = "Вы утвердили запрос. HD снимет резервную копию и применит команды. Итог придёт отдельным сообщением.";
        } else {
          const next = currentStep(result.change);
          const who = next && nameOf(ctx.users?.get(idOf(next.user)));
          text = `Вы подтвердили запрос.${who ? ` Дальше решает ${who}.` : ""}`;
        }
      }
    } catch (error) {
      try { log?.log?.("warn", `Mikrotik change #${n}: telegram reply text`, { error: error?.message }); } catch { /* журнал не критичен */ }
    }
    res.status(200).json({ ok: true, text });
  });

  return { message, decision };
}

// Маршруты: рубильник модуля и «не клиент» стоят до ручки, актор — первым (иначе req.auth пуст)
function mountRoutes(router, { limiter, actorLimiter, attachActor, gates, handlers }) {
  const first = [actorLimiter, limiter].filter(Boolean);
  router.get("/mikrotik-changes/:id/message", ...first, attachActor, ...gates, handlers.message);
  router.post("/mikrotik-changes/:id/decision", ...first, attachActor, ...gates, handlers.decision);
}

// Боевая сборка: единственное место с моделями. Не покрыта тестами (нужна база).
let live;
function liveHandlers() {
  if (!live) {
    const MikrotikChange = require("../../models/mikrotikChange");
    const { liveDecisions } = require("../../services/mikrotik/changeDecisions");
    const { mongoLoadContext } = require("../../services/mikrotik/changeNotifications");
    live = createBotHandlers({
      load: (id) => MikrotikChange.findById(id).lean(),
      loadContext: mongoLoadContext,
      decisions: liveDecisions(),
      baseUrl: process.env.APP_PUBLIC_URL || process.env.VITE_API_ADDRESS || "",
      log: require("../../utils/logger"),
    });
  }
  return live;
}
const lazy = (name) => (req, res, next) => liveHandlers()[name](req, res, next);

module.exports = { createBotHandlers, mountRoutes, gate, actorKey, createActorLimiter, live: { message: lazy("message"), decision: lazy("decision") } };
