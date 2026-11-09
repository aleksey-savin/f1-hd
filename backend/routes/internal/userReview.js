const router = require("express").Router();
const isAuth = require("../../middleware/isAuth");
const review = require("../../controllers/userReview");
// Each operation also enforces staff rights and source visibility in the service.
router.use(isAuth);
router.get("/summary", review.summary);
router.get("/proposals", review.proposals);
router.get("/analyses", review.analyses);
router.post("/scan", review.scan);
router.post("/analyses/:id/retry", review.retryAnalysis);
router.post("/pause", review.pause);
router.post("/proposals/:id/decision", review.decide);
module.exports = router;
