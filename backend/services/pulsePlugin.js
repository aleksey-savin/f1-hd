const mongoose = require("mongoose");

const SPECS = require("./pulseTopics");
const { bus: defaultBus } = require("./pulse");

/**
 * Mongoose plugin that reports writes to the live-update bus.
 *
 *   schema.plugin(require("../services/pulsePlugin"), { model: "Ticket" });
 *
 * Registered in each model file right before `mongoose.model()`: Mongoose
 * copies schema hooks when the model is compiled, so a global plugin would
 * silently miss models required before it. What a write means is decided by the
 * spec in services/pulseTopics.js; this file only reads writes.
 *
 * Covered: `save` (incl. `create`), query writes (`updateOne/Many`,
 * `findOneAndUpdate/Replace/Delete` and their `findById*` forms, `replaceOne`,
 * `deleteOne/Many`, and the document `deleteOne()`/`updateOne()` that run as
 * such queries), `insertMany`, `bulkWrite`. Not
 * covered: raw driver writes (`mongoose.connection.db`), TTL deletes, other
 * processes — the client's max-staleness refresh backs those up.
 *
 * A pulse failure never breaks a write: every hook swallows and logs.
 */

const QUERY_WRITES = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
];
const DELETES = new Set(["deleteOne", "deleteMany", "findOneAndDelete"]);
const REPLACES = new Set(["replaceOne", "findOneAndReplace"]);

// Pre-read cap for writes whose ticket/user ids are not in the filter
const PRE_READ_LIMIT = 1000;

const PENDING = Symbol("pulse");

// The logger is required lazily: model files load this plugin, and scripts that
// only need a model should not spin up log transports.
const warn = (message, error) => {
  try {
    require("../utils/logger").log("warn", message, {
      error: error?.message || String(error),
    });
  } catch {
    // logging must not throw either
  }
};

const idString = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (value._id !== undefined && value._id !== value) return idString(value._id);
  return String(value);
};

/**
 * Flatten an update into `{ path, value, op }` entries. Bare keys are `$set`
 * (Mongoose casts them the same way); `$setOnInsert` does not change an
 * existing document and is skipped.
 */
const updateEntries = (update) => {
  if (!update || typeof update !== "object") return [];
  if (Array.isArray(update)) {
    // aggregation pipeline update: treat every stage key as a change
    return update.flatMap((stage) =>
      Object.keys(stage || {}).map((path) => ({ path, value: undefined, op: "$pipeline" })),
    );
  }
  const entries = [];
  for (const [key, body] of Object.entries(update)) {
    if (key === "$setOnInsert") continue;
    if (key.startsWith("$")) {
      for (const [path, value] of Object.entries(body || {})) {
        entries.push({ path, value, op: key });
      }
    } else {
      entries.push({ path: key, value: body, op: "$set" });
    }
  }
  return entries;
};

/** Topics a set of changed paths moves, or [] when every path is noise. */
const topicsFor = (spec, entries) => {
  const meaningful = entries.filter(({ path, value, op }) => !spec.noise?.(path, value, op));
  if (!meaningful.length) return [];
  if (!spec.byPath) return spec.topics || [];
  const topics = [];
  for (const [topic, paths] of Object.entries(spec.byPath)) {
    const hit = meaningful.some(({ path }) =>
      paths.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)),
    );
    if (hit) topics.push(topic);
  }
  return topics;
};

/** Every topic a spec can move — for inserts and deletes. */
const allTopics = (spec) =>
  spec.byPath ? Object.keys(spec.byPath) : spec.topics || [];

/** Does a spec care about anything beyond topics (tickets, inbox)? */
const tracksRefs = (spec) => Boolean(spec.ticket || spec.user);

/**
 * Classify a document save: `{ topics, meaningful }`. New documents are always
 * meaningful; otherwise the directly modified paths go through the noise rule
 * with their new values.
 */
const classifySave = (doc, spec) => {
  if (doc.isNew) return { topics: allTopics(spec), meaningful: true };
  const entries = doc
    .directModifiedPaths()
    .map((path) => ({ path, value: doc.get(path), op: "$set" }));
  const topics = topicsFor(spec, entries);
  const meaningful = spec.byPath
    ? topics.length > 0
    : entries.some(({ path, value, op }) => !spec.noise?.(path, value, op));
  return { topics, meaningful };
};

/** Classify a query write by its update document. Deletes/replaces are always meaningful. */
const classifyUpdate = (op, update, spec) => {
  if (DELETES.has(op) || REPLACES.has(op)) {
    return { topics: allTopics(spec), meaningful: true };
  }
  const entries = updateEntries(update);
  const topics = topicsFor(spec, entries);
  const meaningful = spec.byPath
    ? topics.length > 0
    : entries.some(({ path, value, op: operator }) => !spec.noise?.(path, value, operator));
  return { topics, meaningful };
};

/**
 * Ids a filter pins a field to: a scalar, an ObjectId or `{ $in: [...] }`.
 * `null` when the filter does not pin the field.
 */
const idsFromFilter = (filter, field) => {
  const value = filter?.[field];
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && !(value instanceof mongoose.Types.ObjectId)) {
    if (Array.isArray(value.$in)) return value.$in.map(idString).filter(Boolean);
    if (value.$eq !== undefined) return [idString(value.$eq)].filter(Boolean);
    return null;
  }
  return [idString(value)].filter(Boolean);
};

/** Ids a document references in `field` ("self" = its own `_id`). */
const idsFromDoc = (doc, field) => {
  if (!doc || !field) return [];
  const value = field === "self" ? doc._id : (doc.get ? doc.get(field) : doc[field]);
  if (Array.isArray(value)) return value.map(idString).filter(Boolean);
  return [idString(value)].filter(Boolean);
};

/** Did a query write change anything, judging by its result? */
const resultChanged = (result) => {
  if (result === null || result === undefined) return false;
  if (typeof result.modifiedCount === "number" || typeof result.upsertedCount === "number") {
    return (result.modifiedCount || 0) + (result.upsertedCount || 0) > 0;
  }
  if (typeof result.deletedCount === "number") return result.deletedCount > 0;
  // findOneAnd* with includeResultMetadata
  if (Object.hasOwn(result, "value") && Object.hasOwn(result, "ok")) {
    return result.value !== null && result.value !== undefined;
  }
  return true; // a returned document
};

const resultDoc = (result) =>
  result && Object.hasOwn(result, "value") && Object.hasOwn(result, "ok")
    ? result.value
    : result;

const emit = (bus, spec, { topics, ticketIds, userIds }) => {
  const change = { topics };
  if (spec.ticket) {
    if (ticketIds && ticketIds.length) change.ticketIds = ticketIds;
    else change.anyTicket = true;
  }
  if (spec.user) {
    if (userIds && userIds.length) change.userIds = userIds;
    else change.anyUser = true;
  }
  bus.bump(change);
};

function pulsePlugin(schema, options = {}) {
  // `spec`/`bus` overrides exist for tests
  const spec = options.spec || SPECS[options.model];
  if (!spec) throw new Error(`pulsePlugin: no spec for model "${options.model}"`);
  const bus = options.bus || defaultBus;

  schema.pre("save", function classifyPulseSave() {
    try {
      this.$locals.pulse = classifySave(this, spec);
    } catch (error) {
      warn("pulse: save classification failed", error);
      this.$locals.pulse = { topics: allTopics(spec), meaningful: true };
    }
  });

  schema.post("save", function emitPulseSave(doc) {
    try {
      const pulse = doc.$locals?.pulse;
      if (!pulse?.meaningful) return;
      emit(bus, spec, {
        topics: pulse.topics,
        ticketIds: idsFromDoc(doc, spec.ticket),
        userIds: idsFromDoc(doc, spec.user),
      });
    } catch (error) {
      warn("pulse: save emit failed", error);
    }
  });

  // `doc.deleteOne()` / `doc.updateOne()` run as queries by `_id`, so the query
  // hooks below cover them — a document-level hook would bump twice.
  schema.pre(QUERY_WRITES, { document: false, query: true }, async function classifyPulseQuery() {
    try {
      const op = this.op;
      const classified = classifyUpdate(op, this.getUpdate(), spec);
      const state = { ...classified, ticketIds: null, userIds: null };
      this[PENDING] = state;
      if (!classified.meaningful || !tracksRefs(spec)) return;

      const filter = this.getFilter();
      if (spec.ticket) {
        state.ticketIds = idsFromFilter(filter, spec.ticket === "self" ? "_id" : spec.ticket);
      }
      if (spec.user) state.userIds = idsFromFilter(filter, spec.user);

      // Ids not in the filter: read them before the write (a delete removes them).
      // Ticket "self" ids come from the returned document or fall back to "any".
      const field = spec.ticket && spec.ticket !== "self" && !state.ticketIds
        ? spec.ticket
        : spec.user && !state.userIds
          ? spec.user
          : null;
      if (!field) return;
      const rows = await this.model
        .find(filter)
        .select(field)
        .limit(PRE_READ_LIMIT + 1)
        .lean();
      if (rows.length > PRE_READ_LIMIT) return;
      const ids = [...new Set(rows.flatMap((row) => idsFromDoc(row, field)))];
      if (field === spec.ticket) state.ticketIds = ids;
      else state.userIds = ids;
    } catch (error) {
      warn("pulse: query classification failed", error);
      this[PENDING] = { topics: allTopics(spec), meaningful: true, ticketIds: null, userIds: null };
    }
  });

  schema.post(QUERY_WRITES, { document: false, query: true }, function emitPulseQuery(result) {
    try {
      const state = this[PENDING];
      if (!state?.meaningful || !resultChanged(result)) return;
      const doc = resultDoc(result);
      const fromDoc = (field) =>
        doc && typeof doc === "object" && !("modifiedCount" in doc) && !("deletedCount" in doc)
          ? idsFromDoc(doc, field)
          : [];
      emit(bus, spec, {
        topics: state.topics,
        ticketIds: state.ticketIds?.length ? state.ticketIds : fromDoc(spec.ticket),
        userIds: state.userIds?.length ? state.userIds : fromDoc(spec.user),
      });
    } catch (error) {
      warn("pulse: query emit failed", error);
    }
  });

  schema.post("insertMany", function emitPulseInsertMany(docs) {
    try {
      const list = Array.isArray(docs) ? docs : [];
      if (!list.length) return;
      emit(bus, spec, {
        topics: allTopics(spec),
        ticketIds: [...new Set(list.flatMap((doc) => idsFromDoc(doc, spec.ticket)))],
        userIds: [...new Set(list.flatMap((doc) => idsFromDoc(doc, spec.user)))],
      });
    } catch (error) {
      warn("pulse: insertMany emit failed", error);
    }
  });

  schema.post("bulkWrite", function emitPulseBulkWrite(result) {
    try {
      const changed =
        (result?.insertedCount || 0) +
        (result?.modifiedCount || 0) +
        (result?.upsertedCount || 0) +
        (result?.deletedCount || 0);
      if (!changed) return;
      emit(bus, spec, { topics: allTopics(spec), ticketIds: [], userIds: [] });
    } catch (error) {
      warn("pulse: bulkWrite emit failed", error);
    }
  });
}

module.exports = pulsePlugin;
module.exports.updateEntries = updateEntries;
module.exports.classifySave = classifySave;
module.exports.classifyUpdate = classifyUpdate;
module.exports.idsFromFilter = idsFromFilter;
module.exports.idsFromDoc = idsFromDoc;
module.exports.resultChanged = resultChanged;
