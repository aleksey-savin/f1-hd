const projectCommentStatus = async (message, owner) => {
  const Message = require("@/models/message");
  const Comment = require("@/models/comment");
  // Snapshot the target before rereading its source. An intervening retry
  // or status webhook must win even when both writes use the same message.
  const comment = await Comment.findById(message.commentId).select("channel").lean();
  const current = await Message.findOne(owner).select("status").lean();
  if (comment && current && (!comment.channel?.messageId || String(comment.channel.messageId) === String(message._id))) {
    const channel = comment.channel || {};
    const error = current.status === "failed" ? "Не доставлено" : undefined;
    if (!channel.messageId || channel.status !== current.status || channel.error !== error) {
      const fields = { "channel.messageId": message._id, "channel.status": current.status, "channel.statusAt": new Date() };
      const change = { $set: fields };
      if (error) fields["channel.error"] = error;
      else change.$unset = { "channel.error": 1 };
      const saved = await Comment.updateOne({
        _id: comment._id, "channel.status": channel.status ?? null, "channel.statusAt": channel.statusAt ?? null,
        "channel.messageId": channel.messageId ?? null,
      }, change);
      if (!saved.matchedCount) throw new Error("Comment changed during delivery projection");
    }
  }
};

// A terminal send is authoritative for its own attempt. Provider delivery
// events and operator retries can both advance the message during recovery.
const projectSendOutcome = async job => {
  const Message = require("@/models/message");
  const ChannelJob = require("@/models/channelJob");
  const owner = { _id: job.messageId, jobId: job._id };
  let message = await Message.findById(job.messageId).lean();
  if (message && !message.jobId && message.direction === "out" && message.origin === "hd") {
    // Older producers inserted the job before linking the message. Recover the
    // newest send attempt even if its channel has since been disabled.
    const latest = await ChannelJob.findOne({ messageId: message._id, type: "send" }).sort({ createdAt: -1, _id: -1 }).select("_id").lean();
    if (String(latest?._id) === String(job._id)) {
      message = await Message.findOneAndUpdate({ _id: message._id, jobId: null }, { $set: { jobId: job._id } }, { returnDocument: "after" }).lean();
    }
  }
  if (message && String(message.jobId) === String(job._id)) {
    if (String(message.projectedSendJobId) !== String(job._id)) {
      const set = { projectedSendJobId: job._id };
      if (job.state === "done" && message.status === "queued") Object.assign(set, { status: "sent", error: "" });
      // Historical jobs have no message-side marker. Preserve an acceptance
      // recorded after the failed attempt; delivery and read always take precedence.
      const sentBeforeFailure = message.status === "sent" && message.updatedAt <= job.finishedAt;
      if (job.state === "failed" && (message.status === "queued" || sentBeforeFailure)) {
        Object.assign(set, { status: "failed", error: job.lastError || "Не отправлено" });
      }
      if (job.result?.externalId && !message.externalId) set.externalId = String(job.result.externalId);
      const ids = job.result?.externalIds;
      const update = { $set: set };
      if (Array.isArray(ids) && ids.length) update.$addToSet = { externalIds: { $each: ids.map(String) } };
      const filter = { ...owner, projectedSendJobId: { $ne: job._id }, status: message.status, externalId: message.externalId ?? null };
      let result;
      try {
        result = await Message.updateOne(filter, update);
      } catch (error) {
        // An earlier echo already owns this unique provider id.
        if (error.code !== 11000 || !set.externalId) throw error;
        delete set.externalId;
        result = await Message.updateOne(filter, update);
      }
      if (!result.matchedCount) throw new Error("Message changed during delivery projection");
    }
    if (message.commentId) await projectCommentStatus(message, owner);
    require("@/services/pulse").bus.bump({ topics: ["conversations"], ticketIds: message.ticketId ? [message.ticketId] : [] });
  }
  await ChannelJob.updateOne({ _id: job._id, state: job.state }, { $set: { outcomeApplied: true }, $unset: { outcomeRetryAt: 1 } });
};

const repairSendOutcomes = async () => {
  const ChannelJob = require("@/models/channelJob");
  // A missing marker includes historical jobs whose ack predated the outbox.
  const jobs = await ChannelJob.find({
    type: "send", state: { $in: ["done", "failed"] }, messageId: { $ne: null },
    outcomeApplied: { $in: [null, false] }, $or: [{ outcomeRetryAt: null }, { outcomeRetryAt: { $lte: new Date() } }],
  }).sort({ finishedAt: 1, _id: 1 }).limit(50).lean();
  for (const job of jobs) {
    try {
      await projectSendOutcome(job);
    } catch (error) {
      await ChannelJob.updateOne({ _id: job._id, outcomeApplied: { $ne: true } }, { $set: { outcomeRetryAt: new Date(Date.now() + 120_000) } });
      require("@/utils/logger").log("warn", "Не удалось восстановить результат отправки", { module: "messaging", jobId: String(job._id), error: error.message });
    }
  }
};

module.exports = { projectCommentStatus, projectSendOutcome, repairSendOutcomes };
