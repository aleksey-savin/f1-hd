const review = require("../services/userReview");
const handler = (run) => async (req, res, next) => {
  try {
    res.status(200).json(await run(req));
  } catch (error) {
    next(error);
  }
};
exports.summary = handler((req) => review.getSummary(req.auth, req.query));
exports.proposals = handler((req) => review.listProposals(req.auth, req.query));
exports.analyses = handler((req) => review.listAnalyses(req.auth, req.query));
exports.scan = handler((req) => review.requestHistoryAnalysis(req.auth));
exports.pause = handler((req) =>
  review.setHistoryPaused(req.auth, req.body?.paused),
);
exports.decide = handler((req) =>
  review.decideProposal(req.auth, req.params.id, req.body, req),
);

exports.retryAnalysis = handler((req) =>
  review.retryAnalysis(req.auth, req.params.id),
);
