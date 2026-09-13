const mongoose = require("mongoose");

const { Ticket } = require("@/models/ticket");
const { AppError } = require("@/middleware/errorHandling");
const { bus } = require("@/services/pulse");
const { canAccessTicket } = require("@/services/ticketAccess");
const { summaryFor } = require("@/controllers/notification");
const packageJson = require("../package.json");

/**
 * GET /pulse?cursor=<epoch>:<rev>&ticket=<id>[,<id>…]
 *
 * One light request per tab instead of a heavy poll per widget: topic revisions
 * from memory, the watched tickets' revisions, and the bell summary when the
 * person's inbox moved. See services/pulse.js and docs/live-updates.md.
 */

// How often the client should ask; it may ask faster while it waits for
// something (AI guide generation), never slower when visible
const POLL_MS = 10_000;
const MAX_WATCHED_TICKETS = 3;

// Topics a client (end user) has pages for; the rest are staff-only screens
const CLIENT_TOPICS = ["tickets", "approval"];

// Enough of the ticket to decide access (services/ticketScope.js)
const SCOPE_FIELDS = "responsibles createdBy applicantId applicant company";

exports.pulse = async (req, res, next) => {
  try {
    const { auth } = req;
    // Revision FIRST: whatever changes while the reads below run gets a higher
    // revision and reaches the client with the next pulse
    const rev = bus.rev();
    const since = bus.parseCursor(req.query.cursor);

    const all = bus.topics();
    const topics = auth.isEndUser
      ? Object.fromEntries(CLIENT_TOPICS.map((topic) => [topic, all[topic]]))
      : all;

    const watched = String(req.query.ticket || "")
      .split(",")
      .filter((id) => mongoose.isValidObjectId(id))
      .slice(0, MAX_WATCHED_TICKETS);
    const tickets = {};
    for (const id of watched) {
      const ticketRev = Math.min(bus.ticketRev(id), rev);
      // Unchanged since the client's cursor: nothing new to disclose
      if (since !== null && ticketRev <= since) {
        tickets[id] = ticketRev;
        continue;
      }
      const ticket = await Ticket.findById(id).select(SCOPE_FIELDS).lean();
      tickets[id] = ticket && canAccessTicket(ticket, auth) ? ticketRev : null;
    }

    const body = {
      epoch: bus.epoch,
      rev,
      pollMs: POLL_MS,
      appVersion: packageJson.version,
      topics,
      tickets,
    };
    if (since === null || bus.userRev(auth.userId) > since) {
      body.notifications = await summaryFor(auth.userId);
    }

    res.set("Cache-Control", "no-store");
    res.status(200).json(body);
  } catch (error) {
    next(new AppError("Failed to fetch pulse", 500, true, error));
  }
};
