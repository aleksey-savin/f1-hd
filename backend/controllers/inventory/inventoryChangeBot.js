// Предложения ИИ-агента об инвентаре: ручки бота Telegram (кнопки решения).
// Бот не хранит ни текст, ни решение — спрашивает здесь. Решает тот же сервис, что и портал (changeDecisions).
//
// Два правила этого файла:
//   1) решает только заявитель (проверка здесь и ещё раз, атомарно, в сервисе решений);
//   2) утвердить из Telegram можно только то, что Telegram показал целиком.
const mongoose = require("mongoose");

const { AppError } = require("../../middleware/errorHandling");
const { MESSAGES } = require("../../services/inventory/changeDecisions");
const { STATUS } = require("../../services/inventory/changeSteps");
const { present: presentChange, resultFor, BIG_NOTE } = require("../../services/inventory/changeRender");
const { actorKey, createActorLimiter } = require("./mikrotikChangeBot");

const idOf = (v) => (v && typeof v === "object" && "_id" in v ? String(v._id) : v == null ? "" : String(v));
const FAILED = "Не удалось записать решение, попробуйте ещё раз";

// Отказ всегда HTTP 200: бот показывает message алертом и по code решает, убирать ли кнопки
const refuse = (res, code, message) => res.status(200).json({ ok: false, code, message: message || MESSAGES[code] });

// Порядок как в changeSteps.decide, но чужому состояние не сообщаем: для него любое предложение «не за вами»
function gate(change, userId, now) {
  if (!change) return "not_found";
  if (idOf(change.requestedBy) !== String(userId)) return "not_yours";
  if (change.status === STATUS.expired) return "expired";
  if (change.status !== STATUS.awaitingRequester) return "closed";
  const expiresAt = change.expiresAt ? new Date(change.expiresAt).getTime() : NaN;
  if (!(now.getTime() < expiresAt)) return "expired";
  return null;
}

function createBotHandlers({ load, decisions, baseUrl = "", now = () => new Date(), log }) {
  const wrap = (label, fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error instanceof AppError ? error : new AppError(`Failed to ${label}`, 500, true, error));
    }
  };
  const find = async (id) => (mongoose.isValidObjectId(id) ? load(id) : null);

  // Что бот покажет сейчас (общее правило changeRender.present). Не влезло — ни кнопок решения, ни шага подтверждения.
  function present(change) {
    const { text, keyboard, fits, confirm } = presentChange(change, { baseUrl });
    return {
      text,
      keyboard: keyboard || null,
      confirmText: fits ? confirm.text : null,
      confirmKeyboard: fits ? confirm.keyboard : null,
      shows: fits,
    };
  }

  const message = wrap("show inventory change", async (req, res) => {
    const change = await find(req.params.id);
    const code = gate(change, req.userId, now());
    if (code) return refuse(res, code);
    const { shows: _shows, ...view } = present(change);
    res.status(200).json({ ok: true, ...view });
  });

  const decision = wrap("decide inventory change", async (req, res) => {
    const kind = req.body?.decision;
    if (kind !== "approve" && kind !== "reject") throw new AppError("decision must be approve or reject", 400);

    const change = await find(req.params.id);
    const code = gate(change, req.userId, now());
    if (code) return refuse(res, code);

    if (kind === "approve" && !present(change).shows) {
      return refuse(res, "too_long", BIG_NOTE);
    }

    let result;
    try {
      result = await decisions.decide({ changeId: req.params.id, userId: req.userId, decision: kind, channel: "telegram", comment: undefined });
    } catch (error) {
      // Что именно записалось, неизвестно: HTTP 500, чтобы tg-service оставил кнопки и поднял тревогу
      try { log?.log?.("error", "Inventory change: telegram decision failed", { error: error?.message, stack: error?.stack }); } catch { /* журнал не критичен */ }
      return res.status(500).json({ ok: false, code: "failed", message: FAILED });
    }
    if (!result.ok) return refuse(res, result.code, result.message);

    res.status(200).json({ ok: true, text: resultFor(result.change) });
  });

  return { message, decision };
}

// Маршруты: рубильник модуля и «не клиент» стоят до ручки, актор — первым (иначе req.auth пуст)
function mountRoutes(router, { limiter, actorLimiter, attachActor, gates, handlers }) {
  const first = [actorLimiter, limiter].filter(Boolean);
  router.get("/inventory-changes/:id/message", ...first, attachActor, ...gates, handlers.message);
  router.post("/inventory-changes/:id/decision", ...first, attachActor, ...gates, handlers.decision);
}

// Боевая сборка: единственное место с моделями. Не покрыта тестами (нужна база).
let live;
function liveHandlers() {
  if (!live) {
    const InventoryChange = require("../../models/inventory/inventoryChange");
    const { liveInventoryDecisions } = require("../../services/inventory/changeDecisions");
    live = createBotHandlers({
      load: (id) => InventoryChange.findById(id).lean(),
      decisions: liveInventoryDecisions(),
      baseUrl: process.env.APP_PUBLIC_URL || process.env.VITE_API_ADDRESS || "",
      log: require("../../utils/logger"),
    });
  }
  return live;
}
const lazy = (name) => (req, res, next) => liveHandlers()[name](req, res, next);

module.exports = { createBotHandlers, mountRoutes, gate, actorKey, createActorLimiter, live: { message: lazy("message"), decision: lazy("decision") } };
