const {
  withApiSession,
  withSshSession,
  sshExec,
  pollDevice,
  buildSshParams,
} = require("./connector");
const { pollParams, resolveJumpContext, recoverToOnline } = require("./monitorState");
const { createArtifact } = require("./artifacts");
const { parseFirmware } = require("./firmware");
const { TIMING } = require("./upgradeConstants");
const { awaitUpdateCheck } = require("./upgradeCheck");

// Real device operations for the upgrade step machine (upgradeSteps.js deps).
// Same connection path as monitoring: knock, TLS pin, transit router. Short
// commands go over the API (it never asks for confirmation); the package
// download goes over SSH (long, streams progress — not for routeros-node's
// per-chunk parser).

const SESSION_DEADLINE_MS = 90 * 1000;

const apiParams = async (record) => {
  const jumpCtx = await resolveJumpContext(record);
  return { ...pollParams(record), jump: jumpCtx?.params };
};

const exportConfig = async (record, userId) => {
  const artifact = await createArtifact(record, { trigger: "pre-upgrade", userId });
  return { artifactId: artifact._id };
};

const setChannel = async (record, channel) =>
  withApiSession(await apiParams(record), (run) =>
    run(["/system/package/update/set", `=channel=${channel}`]),
  );

// `check-for-updates` may return before the check is over; awaitUpdateCheck
// re-prints the row every CHECK_POLL_MS until the status is final (bounded by
// CHECK_WAIT_MS, inside the session deadline), then returns the last row as is.
const checkUpdates = async (record) =>
  withApiSession(
    await apiParams(record),
    async (run) => {
      await run(["/system/package/update/check-for-updates"]);
      return awaitUpdateCheck(run);
    },
    { deadlineMs: SESSION_DEADLINE_MS },
  );

// A download past DOWNLOAD_TIMEOUT_MS rejects with the SSH watchdog's message,
// which describeConnectionError would render as a connection/knock problem.
// Name it for what it is; anything else passes through unchanged. Pure — tested.
const DOWNLOAD_TIMEOUT_TEXT = `превышено ${Math.round(TIMING.DOWNLOAD_TIMEOUT_MS / 60000)} минут`;
const downloadError = (error) =>
  /SSH operation watchdog timeout/i.test(error?.message || "")
    ? Object.assign(new Error(DOWNLOAD_TIMEOUT_TEXT), { code: "MIKROTIK_DOWNLOAD_INCOMPLETE" })
    : error;

const download = async (record) => {
  const jumpCtx = await resolveJumpContext(record);
  try {
    const { result } = await withSshSession(
      { ...buildSshParams(record), jump: jumpCtx?.params },
      (conn) => sshExec(conn, "/system package update download"),
      { opTimeoutMs: TIMING.DOWNLOAD_TIMEOUT_MS },
    );
    return result.toString("utf8");
  } catch (error) {
    throw downloadError(error);
  }
};

// The session dies with the reboot: RouterOS may answer !done first or just
// drop the socket. routeros-node's write() never rejects on socket death, so a
// dropped socket surfaces ONLY as withReadTimeout's "read timeout" — that is
// success. Anything else (a !trap, or ECONNRESET/ETIMEDOUT from connect() —
// the command never reached the device) is a failure and must be rethrown, or
// the item would wait for a reboot that never happened. Pure — tested.
const isRebootSessionDrop = (error) => /read timeout/i.test(error?.message || "");

const reboot = async (record) => {
  try {
    await withApiSession(
      await apiParams(record),
      (run) => run(["/system/reboot"], { timeoutMs: 5000 }),
      { deadlineMs: 30 * 1000 },
    );
  } catch (error) {
    if (isRebootSessionDrop(error)) return;
    throw error;
  }
};

const readRouterboard = async (record) => {
  try {
    return await withApiSession(await apiParams(record), async (run) => {
      const [row = {}] = await run(["/system/routerboard/print"]);
      return {
        routerboard: row.routerboard === "true",
        current: row["current-firmware"],
        upgrade: row["upgrade-firmware"],
      };
    });
  } catch (error) {
    // CHR has no /system/routerboard at all.
    if (/no such command/i.test(error.message || "")) return { routerboard: false };
    throw error;
  }
};

const upgradeRouterboard = async (record) =>
  withApiSession(await apiParams(record), (run) =>
    run(["/system/routerboard/upgrade"], { timeoutMs: 30 * 1000 }),
  );

// A light poll that never throws: { online: false } while the device reboots.
const probe = async (record, { withBoot = false } = {}) => {
  try {
    const poll = await pollDevice(await apiParams(record), {
      verifyFullGroup: false,
      readRouterboard: withBoot,
    });
    return {
      online: true,
      poll,
      version: parseFirmware(poll.resource?.[0]?.version)?.version || null,
      bootCurrent: poll.routerboard?.[0]?.["current-firmware"] || null,
    };
  } catch (error) {
    return { online: false, error };
  }
};

const recover = (record, poll) => recoverToOnline(record, poll);

module.exports = {
  exportConfig,
  setChannel,
  checkUpdates,
  download,
  reboot,
  readRouterboard,
  upgradeRouterboard,
  probe,
  recover,
  // Pure helpers, exported for tests.
  isRebootSessionDrop,
  downloadError,
};
