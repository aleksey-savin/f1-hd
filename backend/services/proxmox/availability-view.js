const { summarize } = require("./availability");
const { fail } = require("./policy");
const availabilityView = (resource, rows, days = 30, to = new Date()) => {
  days = Number(days);
  if (![1, 7, 30, 90].includes(days)) fail("Выберите период 1, 7, 30 или 90 дней");
  const windowStart = +to - days * 86400000;
  const from = new Date(Math.max(Math.min(+new Date(resource.createdAt || to), +to), windowStart));
  const count = days === 1 ? 24 : days === 7 ? 28 : days === 90 ? 45 : 30;
  const width = (+to - windowStart) / count;
  const segments = Array.from({ length: count }, (_, index) => {
    const start = Math.max(+from, windowStart + index * width);
    const end = Math.max(start, windowStart + (index + 1) * width);
    const bucket = summarize(rows, new Date(start), new Date(end));
    return { tone: bucket.downMs > 0 ? "down" : bucket.upMs > 0 ? "ok" : "none" };
  });
  const episodes = rows.filter((row) => row.state === "down").map((row) => {
    const end = Math.min(+to, row.until ? +new Date(row.until) : +new Date(row.lastSeenAt) + 180000);
    const durationMs = Math.max(0, end - Math.max(+from, +new Date(row.from)));
    const ongoing = !row.until && +to - new Date(row.lastSeenAt) < 180000;
    return { startedAt: row.from, endedAt: ongoing ? null : new Date(end), durationMs, ongoing };
  }).filter((episode) => episode.durationMs > 0).sort((a, b) => +new Date(b.startedAt) - new Date(a.startedAt));
  return { ...summarize(rows, from, to), from, to, segments, episodes, monitoredSince: resource.createdAt, lastCheckedAt: resource.lastCheckedAt };
};
module.exports = { availabilityView };
