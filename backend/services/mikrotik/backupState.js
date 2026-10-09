// Config-copy protection of a managed device — pure, for the row DTO.
//
// The only backup HD makes is the scheduled or manual config export (see
// artifacts.js on why binary .backup is not supported), so "are backups set
// up" is the state of `schedules.export` plus the date of the latest export.

const scheduleOn = (schedule) =>
  Boolean(schedule?.frequency) && schedule.frequency !== "off";

// Row field `backup`. `state`:
//   "ok"         — schedule on, a copy exists, the last run did not fail
//   "pending"    — schedule on, the first copy has not been taken yet
//   "failed"     — schedule on, the last run ended with an error
//   "noSchedule" — schedule off, only manual copies exist
//   "none"       — schedule off and no copies at all
const backupView = (schedule, lastExportAt) => {
  const lastAt = lastExportAt || null;
  const nextAt = schedule?.nextRunAt || null;
  if (!scheduleOn(schedule)) {
    return { state: lastAt ? "noSchedule" : "none", lastAt, nextAt: null };
  }
  if (schedule.lastError) return { state: "failed", lastAt, nextAt };
  return { state: lastAt ? "ok" : "pending", lastAt, nextAt };
};

module.exports = { backupView };
