/** UI affordances only; the server independently authorizes each decision. */
export function reviewActions({ canManage, canManageUsers }, proposal, today) {
  const undecided = ["pending", "deferred"].includes(proposal.status);
  const evidence = proposal.evidence || [];
  const sourceTime = (item) => Date.parse(item.sourceAt || "") || 0;
  const latestTime = Math.max(0, ...evidence.map(sourceTime));
  const current = evidence.filter((item) => sourceTime(item) === latestTime);
  const future =
    current
      .map((item) => item.effectiveDate)
      .filter((day) => day && day > today)
      .sort()[0] || null;
  const restricted = current.some(
    (item) =>
      item.employment === "return" ||
      ["restrict", "preserve", "handover"].includes(item.access),
  );
  const change = canManage && canManageUsers;
  const user =
    proposal.user ||
    (typeof proposal.userId === "object" ? proposal.userId : null);
  const accountPresent = Boolean(user?._id);
  const retained = accountPresent && !user.deletedAt;
  const ruleWithoutText =
    ["inactivity", "deletion"].includes(proposal.kind) && !evidence.length;
  const ready =
    !future &&
    !restricted &&
    !proposal.blockedReason &&
    !proposal.blocked &&
    (ruleWithoutText || proposal.actionable !== false);
  return {
    disable:
      change &&
      undecided &&
      retained &&
      !user.banned &&
      ["departure", "inactivity"].includes(proposal.kind) &&
      ready,
    delete:
      change &&
      retained &&
      (proposal.status === "disabled" ||
        (undecided &&
          ["departure", "inactivity", "deletion"].includes(proposal.kind))) &&
      ready,
    restore: change && accountPresent && proposal.status === "deleted",
    match: canManage && undecided && proposal.kind === "unresolved",
    dismiss: canManage && undecided,
    defer: canManage && undecided,
    future,
    restricted,
  };
}
