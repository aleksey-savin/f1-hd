/** Daily, consolidated, scoped review reminder. Backlog produces no per-source alerts. */
const notifyReviewSummary = async ({
  users = [],
  prefs,
  at = new Date(),
  historyRunning = false,
  readStamp,
  writeStamp,
  canFor,
  readSummary,
  upsert,
}) => {
  if (historyRunning || !prefs?.notify?.personal?.userReview) return 0;
  let sent = 0;
  for (const user of users) {
    if (
      user.isEndUser !== false ||
      user.banned ||
      user.deletedAt ||
      user.isServiceAccount ||
      user.notify?.inApp?.userReview === false
    )
      continue;
    const can = await canFor(user);
    if (!can({ userReview: ["read", "manage"] }) || !can({ user: ["manage"] }))
      continue;
    const previous = await readStamp(String(user._id));
    if (previous && at - new Date(previous) < 86400000) continue;
    const auth = {
      userId: String(user._id),
      isEndUser: false,
      isAdmin: !!user.isAdmin,
      user,
      can,
    };
    const summary = await readSummary(auth);
    if (!summary.pending) continue;
    await upsert({
      userId: user._id,
      category: "userReview",
      kind: "userReviewSummary",
      title: "Проверка пользователей",
      text: `Ожидают решения: ${summary.pending}`,
      link: "/users/review",
      readAt: null,
    });
    await writeStamp(String(user._id), at);
    sent++;
  }
  return sent;
};
module.exports = { notifyReviewSummary };
