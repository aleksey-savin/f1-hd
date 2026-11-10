const { createHash } = require("node:crypto");

const ordered = (statements = {}) => Object.entries(statements)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([resource, actions]) => [resource, [...actions].sort()]);

// Calculated from the current request, so role edits, assignments and cache
// expiry are reflected without a separate invalidation event or database read.
const accessVersion = (auth) => createHash("sha256").update(JSON.stringify([
  auth.userId, auth.isAdmin, auth.isEndUser,
  ordered(auth.statements), ordered(auth.grantStatements),
])).digest("hex");

module.exports = { accessVersion };
