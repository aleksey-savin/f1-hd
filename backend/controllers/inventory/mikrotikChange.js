// Запросы ИИ-агентов на изменение Mikrotik: ручки портала. Решения и отзыв — services/mikrotik/changeDecisions
// (его же зовёт бот Telegram), вид — services/mikrotik/changeView. Здесь только HTTP: сессия, коды, заголовки.
const mongoose = require("mongoose");

const { AppError } = require("../../middleware/errorHandling");
const { MESSAGES, liveDecisions } = require("../../services/mikrotik/changeDecisions");
const { toView, isRecipient, isInvolved, wireguardFileName } = require("../../services/mikrotik/changeView");
const { STATUS, currentStep, isOpen } = require("../../services/mikrotik/changeSteps");

const COMMENT_MAX = 300;
const QR_LOG_WINDOW_MS = 10 * 60 * 1000;
const CODE_STATUS = { not_yours: 403, no_right: 403, closed: 409, expired: 410, not_found: 404 };

const idOf = (v) => (v && typeof v === "object" && "_id" in v ? String(v._id) : v == null ? "" : String(v));
const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ");

// Право берётся только из сессии, не из тела запроса
const viewerOf = (req) => ({
  userId: String(req.userId),
  canRead: Boolean(req.auth?.can?.({ mikrotik: ["read"] })),
  canApprove: Boolean(req.auth?.can?.({ mikrotik: ["approveChanges"] })),
  canManageConfigs: Boolean(req.auth?.can?.({ mikrotik: ["manageConfigs"] })),
});

// Комментарий — одна строка до 300 знаков; undefined — без комментария
function parseComment(value) {
  if (value === undefined || value === null || value === "") return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false };
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > COMMENT_MAX) return { ok: false };
  return { ok: true, value: text || undefined };
}

function createController({ decisions, repo, buildClientConfig, decryptSecret, now = () => new Date(), log }) {
  const validId = (id) => mongoose.isValidObjectId(id);
  const refusal = (r) => new AppError(r.message, CODE_STATUS[r.code] || 400);
  const wrap = (label, fn) => async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      // В тексте ошибки секретов нет, но исходную не прикладываем: на пути конфигурации в ней могло быть что угодно
      next(error instanceof AppError ? error : new AppError(`Failed to ${label}`, 500, true, label === "download wireguard config" ? null : error));
    }
  };

  const loadView = async (id, req) => {
    const change = await repo.findById(id);
    return change ? toView(change, viewerOf(req), now()) : null;
  };

  const getOne = wrap("fetch mikrotik change", async (req, res, next) => {
    if (!validId(req.params.id)) return next(new AppError("Запрос не найден", 404));
    const change = await repo.findById(req.params.id);
    const viewer = viewerOf(req);
    // Сотрудник без прав на Mikrotik, не причастный к запросу, не узнаёт даже о его существовании
    const sees = viewer.canRead || viewer.canApprove || viewer.canManageConfigs;
    if (!change || (!sees && !isInvolved(change, viewer.userId))) {
      return next(new AppError("Запрос не найден", 404));
    }
    res.status(200).json(toView(change, viewer, now()));
  });

  const listForRecord = wrap("list mikrotik changes", async (req, res, next) => {
    if (!validId(req.params.recordId) || !(await repo.recordExists(req.params.recordId))) {
      return next(new AppError("Устройство не найдено", 404));
    }
    const viewer = viewerOf(req);
    const all = await repo.listByRecord(req.params.recordId);
    // Маршрут закрыт правом mikrotik.read; здесь тот же порог, что у просмотра, — чтобы ручка не раскрывала
    // чужие запросы, даже если гейт маршрута когда-нибудь ослабят
    const sees = viewer.canRead || viewer.canApprove || viewer.canManageConfigs;
    const list = sees ? all : all.filter((change) => isInvolved(change, viewer.userId));
    res.status(200).json(list.map((change) => toView(change, viewer, now())));
  });

  // Главная: запросы, где текущий шаг за смотрящим. Базу спрашиваем грубо, остальное досчитываем здесь
  const awaitingMe = wrap("list awaiting mikrotik changes", async (req, res) => {
    const viewer = viewerOf(req);
    const at = now().getTime();
    const list = (await repo.listAwaiting(viewer.userId)).filter((change) => {
      // Без срока или с битой датой запрос считается истёкшим — как в сервисе решений
      if (!isOpen(change.status) || !(at < (change.expiresAt ? new Date(change.expiresAt).getTime() : NaN))) return false;
      const step = currentStep(change);
      return Boolean(step) && idOf(step.user) === viewer.userId;
    });
    res.status(200).json(list.map((change) => toView(change, viewer, now())));
  });

  // Тот же порог, что у просмотра: без прав на Mikrotik и не участник — запроса «нет», иначе код ответа
  // (403/409/410 против 404) выдавал бы существование и состояние чужого запроса
  const hidden = async (req) => {
    const viewer = viewerOf(req);
    if (viewer.canRead || viewer.canApprove || viewer.canManageConfigs) return false;
    const change = await repo.findById(req.params.id);
    return !change || !isInvolved(change, viewer.userId);
  };

  const decide = wrap("decide mikrotik change", async (req, res, next) => {
    const { decision } = req.body || {};
    const comment = parseComment(req.body?.comment);
    if ((decision !== "approve" && decision !== "reject") || !comment.ok) {
      return next(new AppError("Некорректное решение", 400));
    }
    if (!validId(req.params.id) || (await hidden(req))) return next(new AppError(MESSAGES.not_found, 404));
    const result = await decisions.decide({
      changeId: req.params.id,
      userId: viewerOf(req).userId,
      decision,
      comment: comment.value,
      channel: "portal",
      canApprove: viewerOf(req).canApprove,
    });
    if (!result.ok) return next(refusal(result));
    res.status(200).json(await loadView(req.params.id, req));
  });

  const cancel = wrap("cancel mikrotik change", async (req, res, next) => {
    if (!validId(req.params.id) || (await hidden(req))) return next(new AppError(MESSAGES.not_found, 404));
    const result = await decisions.cancel({ changeId: req.params.id, userId: viewerOf(req).userId });
    if (!result.ok) return next(refusal(result));
    res.status(200).json(await loadView(req.params.id, req));
  });

  // Конфигурация WireGuard: получатель — заявитель и решавшие. Секреты расшифровываются здесь и нигде не логируются
  const downloadWireguard = wrap("download wireguard config", async (req, res, next) => {
    if (!validId(req.params.id) || (await hidden(req))) return next(new AppError("Запрос не найден", 404));
    const viewer = viewerOf(req);
    // Кто получатель, решаем по записи без секретов; ключи читаем из базы только для него
    const open = await repo.findById(req.params.id);
    if (!open) return next(new AppError("Запрос не найден", 404));
    if (!isRecipient(open, viewer.userId)) {
      return next(new AppError("Конфигурация доступна заявителю и тем, кто решал запрос", 403));
    }
    const change = await repo.findById(req.params.id, { secrets: true });
    if (!change) return next(new AppError("Запрос не найден", 404));
    const wg = change.wireguard;
    if (change.status !== "applied") return next(new AppError("Конфигурация появится после применения запроса", 409));
    if (!wg?.client?.address) return next(new AppError("В этом запросе нет конфигурации для сотрудника", 404));
    const expires = wg.keysExpireAt ? new Date(wg.keysExpireAt).getTime() : 0;
    if (expires <= now().getTime() || !wg.privateKey) {
      return next(new AppError("Срок хранения конфигурации истёк, ключи удалены", 410));
    }

    let text;
    try {
      text = buildClientConfig({
        privateKey: decryptSecret(wg.privateKey),
        address: wg.client.address,
        dns: wg.client.dns || [],
        serverPublicKey: wg.serverPublicKey,
        presharedKey: wg.presharedKey ? decryptSecret(wg.presharedKey) : undefined,
        endpoint: wg.client.endpoint || wg.endpoint,
        allowedIps: wg.client.allowedIps || [],
      });
      // Не записалось в хронику — файл не отдаём: каждое чтение должно быть видно. Показ QR — отдельная запись,
      // не чаще раза в 10 минут на человека (конфиг при этом отдаётся каждый раз)
      const viaQr = req.query?.via === "qr";
      const recentQr = (change.timeline || []).some(
        (t) => t.kind === "qr" && idOf(t.user) === viewer.userId && t.at && now().getTime() - new Date(t.at).getTime() < QR_LOG_WINDOW_MS,
      );
      if (!(viaQr && recentQr)) {
        const name = await repo.userName(viewer.userId);
        await repo.pushTimeline(req.params.id, {
          at: now(),
          kind: viaQr ? "qr" : "download",
          user: viewer.userId,
          text: viaQr ? `Показан QR-код конфигурации: ${name}` : `Скачана конфигурация: ${name}`,
        });
      }
    } catch (error) {
      // Причина — только сообщение ошибки (расшифровка и сборка секретов в нём не несут); конфигурацию не логируем
      try { log?.log?.("error", "Mikrotik change: wireguard download failed", { number: change.number, error: error?.message }); } catch { /* журнал не критичен */ }
      throw new AppError("Failed to download wireguard config", 500);
    }
    res.status(200);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${wireguardFileName(change)}.conf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(text);
  });

  return { getOne, listForRecord, awaitingMe, decide, cancel, downloadWireguard };
}

// Боевая сборка: единственное место с моделями и реальными зависимостями. Не покрыта тестами (нужна база).
const POPULATE = [
  { path: "requestedBy", select: "firstName lastName" },
  { path: "responsible", select: "firstName lastName" },
  { path: "steps.user", select: "firstName lastName" },
  { path: "timeline.user", select: "firstName lastName" },
  {
    path: "mikrotik",
    select: "name label companyId clientDevice",
    populate: [
      { path: "companyId", select: "alias fullTitle" },
      {
        path: "clientDevice",
        select: "companyId serialNumber deviceModelId",
        populate: [
          { path: "companyId", select: "alias fullTitle" },
          { path: "deviceModelId", select: "name" },
        ],
      },
    ],
  },
  { path: "backupArtifact", select: "createdAt" },
];

function realDeps() {
  const MikrotikChange = require("../../models/mikrotikChange");
  const Mikrotik = require("../../models/mikrotik");
  const User = require("../../models/user");
  const logger = require("../../utils/logger");
  const { decryptSecret } = require("../../services/crypto/secretBox");
  const { buildClientConfig } = require("../../services/mikrotik/wireguardConfig");

  return {
    decisions: liveDecisions(),
    log: logger,
    repo: {
      findById(id, { secrets } = {}) {
        const query = MikrotikChange.findById(id);
        if (secrets) query.select("+wireguard.privateKey +wireguard.presharedKey");
        return query.populate(POPULATE).lean();
      },
      listByRecord(recordId) {
        return MikrotikChange.find({ mikrotik: recordId }).sort({ createdAt: -1 }).limit(50).populate(POPULATE).lean();
      },
      async recordExists(id) {
        return Boolean(await Mikrotik.exists({ _id: id }));
      },
      listAwaiting(userId) {
        return MikrotikChange.find({ status: { $in: [STATUS.awaitingRequester, STATUS.awaitingResponsible] }, "steps.user": userId, expiresAt: { $gt: new Date() } })
          .sort({ createdAt: -1 })
          .limit(100)
          .populate(POPULATE)
          .lean();
      },
      pushTimeline(id, entry) {
        return MikrotikChange.updateOne({ _id: id }, { $push: { timeline: entry } });
      },
      async userName(id) {
        return fullName(await User.findById(id).select("firstName lastName").lean());
      },
    },
    decryptSecret,
    buildClientConfig,
  };
}

// Зависимости собираются при первом обращении: модуль можно подключить без базы и логгера
let built;
const lazy = (name) => (req, res, next) => {
  built ||= createController(realDeps());
  return built[name](req, res, next);
};

module.exports = {
  createController,
  getOne: lazy("getOne"),
  listForRecord: lazy("listForRecord"),
  awaitingMe: lazy("awaitingMe"),
  decide: lazy("decide"),
  cancel: lazy("cancel"),
  downloadWireguard: lazy("downloadWireguard"),
};
