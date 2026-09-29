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

const sinceMs = (now, date) =>
  date ? now.getTime() - new Date(date).getTime() : Infinity;

const lastLine = (text) =>
  String(text || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";

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

const waitAfterReboot = async (item, record, deps, now, { boot }) => {
  const elapsed = sinceMs(now, item.rebootRequestedAt);
  if (elapsed < TIMING.MIN_REBOOT_MS) return null;

  const probe = await deps.probe(record, { withBoot: boot });
  if (!probe.online) {
    if (elapsed < TIMING.WAIT_LIMIT_MS) return null;
    return failWith(
      now,
      "Устройство не ответило за 10 минут после перезагрузки. Проверьте его вручную — пакет остановлен.",
      { stopBatch: `${item.name} не вернулся после перезагрузки` },
    );
  }

  // The probe's routerboard read is best-effort: online with no bootCurrent
  // means "not readable yet", not "came back with the old RouterBOOT".
  if (boot && probe.bootCurrent == null) {
    if (elapsed < TIMING.WAIT_LIMIT_MS) return null;
    return failWith(
      now,
      "Не удалось прочитать версию RouterBOOT после перезагрузки — проверьте устройство вручную.",
    );
  }

  const reached = boot
    ? probe.bootCurrent === item.to?.boot
    : compareVersions(probe.version || "", item.to?.os || "") === 0;
  if (reached) {
    return boot
      ? next(now, "verify", {}, `RouterBOOT ${item.to.boot}`)
      : next(now, "routerboot", {}, `RouterOS ${item.to.os}`);
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
        await deps.setChannel(record, item.channel);
        return next(now, "check", {}, `Ветка обновлений: ${item.channel}`);
      }
      case "check": {
        const update = await deps.checkUpdates(record);
        if (/^error/i.test(update.status || "")) {
          throw coded("MIKROTIK_UPDATE_STATUS", update.status);
        }
        if (update.channel && update.channel !== item.channel) {
          throw coded(
            "MIKROTIK_CHANNEL_MISMATCH",
            `Устройство сообщило ветку ${update.channel} вместо ${item.channel} — обновление остановлено`,
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
        const from = { ...(item.from || {}), os: update.installed };
        const cmp = compareVersions(update.latest, update.installed);
        if (cmp <= 0) {
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
        return next(now, "download", { from, to: { os: update.latest } }, `Доступна ${update.latest}`);
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
