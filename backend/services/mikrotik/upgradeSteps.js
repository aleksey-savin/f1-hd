const { compareVersions } = require("./firmware");
const { describeUpgradeError } = require("./upgradeErrors");
const { TIMING } = require("./upgradeConstants");
const { isFinalUpdateStatus } = require("./upgradeCheck");

// One device's firmware upgrade as a step machine (spec «Worker»). Pure over
// the injected device operations (services/mikrotik/upgradeDevice.js in
// production, fakes in tests). Every step is safe to repeat after a restart.
//
// Returns null when nothing changed this tick (waiting), else a patch:
// { set: fields of the item, log?: text, stopBatch?: reason }.
//
// Legs (RouterOS 6 → 7): an item may walk several channels in a row —
// `item.legs` with `item.leg` as the cursor. channel → check → download →
// reboot → wait repeat per leg; export runs once at the start, RouterBOOT and
// verify once at the end. A single-leg item (the common case, and every item
// written before legs existed) takes the same path exactly once.

const MINUTE = 60 * 1000;

const sinceMs = (now, date) =>
  date ? now.getTime() - new Date(date).getTime() : Infinity;

const lastLine = (text) =>
  String(text || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";

const legCount = (item) => item.legs?.length || 1;
const legIndex = (item) => item.leg ?? 0;
const legChannel = (item) => item.legs?.[legIndex(item)] ?? item.channel;
const isLastLeg = (item) => legIndex(item) >= legCount(item) - 1;
const legLabel = (item) => `переход ${legIndex(item) + 1} из ${legCount(item)}`;

const next = (now, step, set = {}, log) => ({
  set: { step, stepStartedAt: now, ...set },
  ...(log ? { log } : {}),
});

const failWith = (now, message, extra = {}) => ({
  set: { state: "failed", finishedAt: now, error: message },
  log: message,
  ...extra,
});

const fail = (now, error) => {
  const { message, fix } = describeUpgradeError(error);
  const patch = failWith(now, message);
  if (fix) patch.set.fix = fix;
  return patch;
};

const coded = (code, message) => Object.assign(new Error(message), { code });

// Moving on to the next leg: the reboot stamp must be clear before the next
// `reboot` step, or a restarted worker would take it for a reboot already sent.
// The version this leg really installed replaces the planned placeholder
// («7.x») in `path`, so the UI shows «7.12.1 ✓» — a positional array write the
// worker turns into `items.$.path.<i>`.
const nextLeg = (item, now, log) => {
  const leg = legIndex(item);
  const landed =
    item.hopTo && Array.isArray(item.path) && item.path.length > leg + 1
      ? { [`path.${leg + 1}`]: item.hopTo }
      : {};
  return next(
    now,
    "channel",
    { leg: leg + 1, rebootRequestedAt: null, hopTo: null, ...landed },
    log,
  );
};

const NO_V7_OFFERED =
  "Ветка upgrade не предлагает RouterOS 7 для этого устройства — переход невозможен, устройство остаётся на RouterOS 6";

const waitAfterReboot = async (item, record, deps, now, { boot }) => {
  const elapsed = sinceMs(now, item.rebootRequestedAt);
  if (elapsed < TIMING.MIN_REBOOT_MS) return null;

  // The first boot into v7 converts the configuration — the `upgrade` leg
  // gets the longer bound.
  const limit =
    !boot && legChannel(item) === "upgrade"
      ? TIMING.MAJOR_WAIT_LIMIT_MS
      : TIMING.WAIT_LIMIT_MS;

  const probe = await deps.probe(record, { withBoot: boot });
  if (!probe.online) {
    if (elapsed < limit) return null;
    return failWith(
      now,
      `Устройство не ответило за ${Math.round(limit / MINUTE)} минут после перезагрузки. Проверьте его вручную — пакет остановлен.`,
      { stopBatch: `${item.name} не вернулся после перезагрузки` },
    );
  }

  // The probe's routerboard read is best-effort: online with no bootCurrent
  // means "not readable yet", not "came back with the old RouterBOOT".
  if (boot && probe.bootCurrent == null) {
    if (elapsed < limit) return null;
    return failWith(
      now,
      "Не удалось прочитать версию RouterBOOT после перезагрузки — проверьте устройство вручную.",
    );
  }

  // The version this leg installs: what `check` found (hopTo), or the planned
  // final version for items written before legs existed.
  const target = item.hopTo || item.to?.os || "";
  const reached = boot
    ? probe.bootCurrent === item.to?.boot
    : compareVersions(probe.version || "", target) === 0;
  if (reached) {
    if (boot) return next(now, "verify", {}, `RouterBOOT ${item.to.boot}`);
    if (!isLastLeg(item)) {
      return nextLeg(item, now, `RouterOS ${target} — ${legLabel(item)} готов`);
    }
    return next(now, "routerboot", {}, `RouterOS ${item.to.os}`);
  }
  if (elapsed < TIMING.OLD_VERSION_GRACE_MS) return null;
  return failWith(
    now,
    boot
      ? `Устройство вернулось с прежним RouterBOOT ${probe.bootCurrent} — обновление не применилось.`
      : `Устройство вернулось с прежней версией ${probe.version || "—"} — установка не произошла.`,
  );
};

const runStep = async (item, { record, job }, deps) => {
  const now = deps.now();
  if (!record) return failWith(now, "Устройство удалено из HD — пропущено");

  const step = item.step || "export";
  try {
    switch (step) {
      case "export": {
        const { artifactId } = await deps.exportConfig(record, job.createdBy);
        return next(now, "channel", { artifactId }, "Копия конфигурации сохранена");
      }
      case "channel": {
        // Always set (idempotent): the build's branch in record.currentFirmware
        // is not the device's configured update channel — a long-term build
        // with channel=stable configured would otherwise install stable.
        const channel = legChannel(item);
        await deps.setChannel(record, channel);
        return next(
          now,
          "check",
          {},
          legCount(item) > 1
            ? `Переход ${legIndex(item) + 1} из ${legCount(item)}: ветка ${channel}`
            : `Ветка обновлений: ${channel}`,
        );
      }
      case "check": {
        const channel = legChannel(item);
        const update = await deps.checkUpdates(record);
        if (/^error/i.test(update.status || "")) {
          throw coded("MIKROTIK_UPDATE_STATUS", update.status);
        }
        if (update.channel && update.channel !== channel) {
          throw coded(
            "MIKROTIK_CHANNEL_MISMATCH",
            `Устройство сообщило ветку ${update.channel} вместо ${channel} — обновление остановлено`,
          );
        }
        // A missing latest-version or a transient status («finding out latest
        // version...») is an unfinished check: the previous latest-version
        // would be stale, and «already current» would be a guess.
        if (!update.latest || !isFinalUpdateStatus(update.status)) {
          throw coded(
            "MIKROTIK_UPDATE_STATUS",
            update.status || "устройство не сообщило latest-version",
          );
        }
        // The item's `from` is where it started; a later leg must not overwrite it.
        const from = { ...(item.from || {}), os: item.from?.os || update.installed };
        const cmp = compareVersions(update.latest, update.installed);
        if (cmp <= 0) {
          // The bridge channel offered nothing: MikroTik has no v7 build for
          // this board. Moving on would flash RouterBOOT and call 6.49.x done.
          if (channel === "upgrade") return failWith(now, NO_V7_OFFERED);
          if (!isLastLeg(item)) {
            return nextLeg(
              item,
              now,
              `Ветка ${channel}: RouterOS уже актуальна — ${legLabel(item)} не нужен`,
            );
          }
          // A device ahead of its branch (say, a testing build) is left alone:
          // downgrades are refused, never attempted.
          return next(
            now,
            "routerboot",
            { from, to: { os: update.installed } },
            cmp < 0
              ? "RouterOS новее последней версии ветки — понижение не выполняется"
              : "RouterOS уже актуальна",
          );
        }
        // The final `to` is the plan's; an intermediate leg only records its hop.
        return next(
          now,
          "download",
          {
            from,
            hopTo: update.latest,
            ...(isLastLeg(item) ? { to: { os: update.latest } } : {}),
          },
          `Доступна ${update.latest}`,
        );
      }
      case "download": {
        const output = await deps.download(record);
        if (!/downloaded/i.test(output || "")) {
          throw coded("MIKROTIK_DOWNLOAD_INCOMPLETE", lastLine(output) || "нет ответа");
        }
        return next(now, "reboot", {}, "Пакет загружен");
      }
      case "reboot":
      case "routerbootReboot": {
        const waitStep = step === "reboot" ? "wait" : "routerbootWait";
        if (item.rebootRequestedAt) return next(now, waitStep);
        await deps.save({ rebootRequestedAt: now });
        await deps.reboot(record);
        return next(now, waitStep, { rebootRequestedAt: now }, "Перезагрузка");
      }
      case "wait":
        return waitAfterReboot(item, record, deps, now, { boot: false });
      case "routerbootWait":
        return waitAfterReboot(item, record, deps, now, { boot: true });
      case "routerboot": {
        const rb = await deps.readRouterboard(record);
        const from = { ...(item.from || {}), boot: rb.current || undefined };
        // No `upgrade-firmware` reported means nothing to flash — same as current.
        if (!rb.routerboard || !rb.current || !rb.upgrade || rb.current === rb.upgrade) {
          return next(
            now,
            "verify",
            { from, to: { ...(item.to || {}), boot: rb.current || undefined } },
            rb.routerboard ? "RouterBOOT уже актуален" : "RouterBOOT нет (CHR)",
          );
        }
        await deps.upgradeRouterboard(record);
        return next(
          now,
          "routerbootReboot",
          { from, to: { ...(item.to || {}), boot: rb.upgrade }, rebootRequestedAt: null },
          `RouterBOOT → ${rb.upgrade}`,
        );
      }
      case "verify": {
        const probe = await deps.probe(record, { withBoot: false });
        if (!probe.online) {
          if (sinceMs(now, item.stepStartedAt) < TIMING.VERIFY_LIMIT_MS) return null;
          return failWith(now, "Устройство перестало отвечать после обновления. Проверьте его вручную.");
        }
        await deps.recover(record, probe.poll);
        return { set: { state: "done", finishedAt: now }, log: "Готово" };
      }
      default:
        return failWith(now, `Неизвестный шаг ${step}`);
    }
  } catch (error) {
    return fail(now, error);
  }
};

module.exports = { runStep };
