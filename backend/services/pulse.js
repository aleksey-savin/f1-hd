const crypto = require("crypto");

/**
 * Live-update bus: "what changed since revision R".
 *
 * The frontend no longer re-reads heavy lists on a timer. One light poll per tab
 * (`GET /api/pulse`) reads these counters, and a page refetches only when its
 * topic moved. Writes reach the bus through the Mongoose plugin
 * (`services/pulsePlugin.js`) and a few explicit bumps (Mikrotik monitoring).
 *
 * One global monotonic sequence instead of a counter per topic: each topic keeps
 * the sequence of its last bump, so a single cursor number compares against any
 * topic. `epoch` changes on every process start — counters live in memory, and a
 * cursor from a previous process means nothing (the client then refetches all).
 *
 * In-memory on purpose: the backend is a single process (see compose.prod.yml).
 * Replicas would need a shared bus behind the same interface.
 *
 * See docs/live-updates.md.
 */

const TOPICS = ["tickets", "presence", "team", "mikrotik", "approval", "knowledge"];

const createBus = ({ ticketCapacity = 5000 } = {}) => {
  const epoch = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  let seq = 0;
  const topicRevs = Object.fromEntries(TOPICS.map((topic) => [topic, 0]));

  // Per-ticket revisions, bounded: Map keeps insertion order, so re-inserting on
  // every bump makes the first entry the least recently changed one. An evicted
  // ticket may have changed as late as `ticketFloor`, and that is what it reports.
  const ticketRevs = new Map();
  let ticketFloor = 0;
  // A ticket write whose ticket is unknown (filter without `_id`, bulkWrite)
  // counts as a change of every ticket.
  let anyTicketRev = 0;

  const userRevs = new Map();
  let anyUserRev = 0;

  /**
   * Record a change. Never throws: a live-update failure must not break a write.
   *
   * @param {object} change
   * @param {string[]} [change.topics]
   * @param {Array<string|object>} [change.ticketIds]
   * @param {boolean} [change.anyTicket]
   * @param {Array<string|object>} [change.userIds]
   * @param {boolean} [change.anyUser]
   */
  const bump = ({ topics = [], ticketIds = [], anyTicket = false, userIds = [], anyUser = false } = {}) => {
    try {
      const known = topics.filter((topic) => Object.hasOwn(topicRevs, topic));
      if (!known.length && !ticketIds.length && !anyTicket && !userIds.length && !anyUser) {
        return;
      }
      seq += 1;
      for (const topic of known) topicRevs[topic] = seq;

      for (const id of ticketIds) {
        if (!id) continue;
        const key = String(id);
        ticketRevs.delete(key);
        ticketRevs.set(key, seq);
      }
      while (ticketRevs.size > ticketCapacity) {
        const [oldestKey, oldestRev] = ticketRevs.entries().next().value;
        ticketRevs.delete(oldestKey);
        ticketFloor = Math.max(ticketFloor, oldestRev);
      }
      if (anyTicket) anyTicketRev = seq;

      for (const id of userIds) {
        if (id) userRevs.set(String(id), seq);
      }
      if (anyUser) anyUserRev = seq;
    } catch {
      // swallow: see above
    }
  };

  /** Revision of the ticket's last change (conservative after eviction). */
  const ticketRev = (id) =>
    Math.max(ticketRevs.get(String(id)) ?? ticketFloor, anyTicketRev);

  /** Revision of the last change in the person's in-app inbox. */
  const userRev = (id) => Math.max(userRevs.get(String(id)) ?? 0, anyUserRev);

  const rev = () => seq;
  const cursor = () => `${epoch}:${seq}`;
  const topics = () => ({ ...topicRevs });

  /** `"<epoch>:<rev>"` → rev, or null when absent or from another process. */
  const parseCursor = (raw) => {
    if (typeof raw !== "string") return null;
    const separator = raw.lastIndexOf(":");
    if (separator <= 0 || raw.slice(0, separator) !== epoch) return null;
    const value = Number(raw.slice(separator + 1));
    return Number.isInteger(value) && value >= 0 ? value : null;
  };

  return { epoch, bump, ticketRev, userRev, rev, cursor, topics, parseCursor };
};

const bus = createBus();

module.exports = { bus, createBus, TOPICS };
