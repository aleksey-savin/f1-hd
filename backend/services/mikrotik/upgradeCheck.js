const { TIMING } = require("./upgradeConstants");

// Reading the result of `/system/package/update/check-for-updates`. Pure over
// the API session's command runner — shared by upgradeDevice.js (the real
// session) and upgradeSteps.js (which refuses a row that is not final).
//
// RouterOS keeps the PREVIOUS `latest-version` in `/system/package/update/print`
// (possibly from another channel), and `check-for-updates` may return before
// the check completes, with a transient status («finding out latest
// version...», «checking...»). Only these statuses mean the row is current.
const isFinalUpdateStatus = (status) =>
  /new version is available|system is already up to date|^error/i.test(status || "");

const readUpdateRow = (row = {}) => ({
  channel: row.channel,
  installed: row["installed-version"],
  latest: row["latest-version"],
  status: row.status || "",
});

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Print the update row, and while its status is not final re-print every
// intervalMs until limitMs is spent (never sleeping past the bound); then hand
// back the last row as is — the step machine turns a non-final one into a
// failure with the device's own status text.
const awaitUpdateCheck = async (
  run,
  {
    sleep = defaultSleep,
    now = Date.now,
    limitMs = TIMING.CHECK_WAIT_MS,
    intervalMs = TIMING.CHECK_POLL_MS,
  } = {},
) => {
  const started = now();
  for (;;) {
    const [row] = await run(["/system/package/update/print"]);
    const update = readUpdateRow(row);
    if (isFinalUpdateStatus(update.status)) return update;
    if (now() - started + intervalMs > limitMs) return update;
    await sleep(intervalMs);
  }
};

module.exports = { isFinalUpdateStatus, readUpdateRow, awaitUpdateCheck };
