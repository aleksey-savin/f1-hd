const Router = require("express");
const router = new Router();
const workController = require("../controllers/work");
const isAuth = require("../middleware/isAuth");

router.get(
  "/works/additional-data/:ticketNum",
  isAuth,
  workController.getAdditionalData,
);
router.get("/works/:ticketNum", isAuth, workController.getTicketWorks);
router.get("/all-scheduled-works", isAuth, workController.getAllScheduled);

router.post("/works/add", isAuth, workController.add);
router.post("/works/schedule", isAuth, workController.schedule);
router.post("/works/update/:workId", isAuth, workController.update);
router.post("/works/delete", isAuth, workController.delete);

module.exports = router;
