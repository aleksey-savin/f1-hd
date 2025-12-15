const Router = require("express");
const router = new Router();
const commentController = require("@/controllers/comment");
const isAuth = require("@/middleware/isAuth");
const fileUpload = require("@/middleware/fileUpload");

const { runValidation } = require("@/middleware/runValidation");
const commentValidation = require("@/validations/comment");

router.get("/comments/:ticketNum", isAuth, commentController.getAll);

router.post(
  "/comments/add",
  isAuth,
  fileUpload.array("attachments"),
  commentValidation.add,
  runValidation,
  commentController.add,
);

module.exports = router;
