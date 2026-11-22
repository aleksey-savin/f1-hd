const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const datetime = require("../utils/datetime");

// Exercise actual handlers through query construction; stop before database execution.
for (const [file, name, model] of [["ticket.js", "getClosed", "Ticket"], ["work.js", "getFinished", "Work"]]) {
  for (const [zone, day, start, end] of [
    ["Asia/Vladivostok", "2026-11-22", "2026-11-21T14:00:00.000Z", "2026-11-22T14:00:00.000Z"],
    ["America/New_York", "2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"],
    ["America/New_York", "2026-11-01", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
  ]) test(`${name}: ${day} uses complete calendar days in ${zone}`, async () => {
    const source = readFileSync(`${__dirname}/${file}`, "utf8");
    const begin = source.indexOf(`exports.${name} =`);
    const body = source.slice(begin, source.indexOf("\n};", begin) + 3);
    let query;
    const deps = {
      ...datetime,
      Preferences: { findOne: async () => ({ timezone: zone }) },
      [model]: { find: (value) => { query = value; throw new Error("query captured"); } },
      parseIdList: () => [], parseObjectIdList: () => [],
      ticketListFilter: () => ({}), ticketTier: () => "all",
      canSeeMoney: () => true,
      CLOSED_PAGE_LIMIT_DEFAULT: 50, CLOSED_PAGE_LIMIT_MAX: 100,
      CLOSED_SORT: { finished_desc: {} },
      FINISHED_PAGE_LIMIT_DEFAULT: 50, FINISHED_PAGE_LIMIT_MAX: 100,
      FINISHED_SORT: { finished_desc: {} },
      AppError: Error,
    };
    const handler = new Function("exports", ...Object.keys(deps), `${body}; return exports.${name};`)({}, ...Object.values(deps));
    let error;
    await handler({ query: { from: day, to: day }, auth: { legacy: {}, can: () => true } }, {}, (e) => { error = e; });
    assert.ok(query, error?.message);
    assert.equal(query.finishedAt.$gte.toISOString(), start);
    assert.equal(query.finishedAt.$lt.toISOString(), end);
  });
}
