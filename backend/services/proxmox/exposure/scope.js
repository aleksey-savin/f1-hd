const { createHash } = require("node:crypto");
const nodeScope = (node) => ({
  connectionId: String(node.connectionId?._id || node.connectionId),
  nodeName: node.nodeName,
});
const belongsToNode = (link, node) => {
  const scope = nodeScope(node);
  return (
    String(link.connectionId) === scope.connectionId &&
    link.nodeName === scope.nodeName
  );
};
// Canonical fields and order keep unrelated edits and MongoDB field ordering
// from invalidating an otherwise unchanged node's observations.
const nodeLinksVersion = (links, node) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        links
          .filter((link) => belongsToNode(link, node))
          .map((link) => [
            String(link._id || ""),
            String(link.connectionId),
            link.nodeName,
            link.bridge,
            link.vlan ?? null,
            link.cidr,
            String(link.routerId || ""),
            link.lanInterface,
            link.wan?.kind,
            link.wan?.name,
          ])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ),
    )
    .digest("hex");
module.exports = { nodeScope, belongsToNode, nodeLinksVersion };
