const Router = require("express");
const router = new Router();
const deviceController = require("@/controllers/inventory/clientDevice");
const isAuth = require("@/middleware/isAuth");
const { uploadPhotos } = require("@/middleware/imageUpload");
const { canManageDevices } = require("@/middleware/permissions");
const {
  clientDeviceValidation,
} = require("@/validations/inventory/clientDevice");
const { checkValidationResult } = require("@/middleware/validation");

router.get("/client-devices", isAuth, deviceController.getAll);
// До "/:id", иначе литеральные сегменты уедут в параметр id.
router.get("/client-devices/attachable", isAuth, deviceController.getAttachable);
router.get("/client-devices/facets", isAuth, deviceController.getFacets);
// Мягкая проверка серийника: совпадение — предупреждение формы, не запрет.
router.get("/client-devices/serial-check", isAuth, deviceController.checkSerial);
router.get("/client-devices/:id", isAuth, deviceController.getOne);
// Заявки, ссылающиеся на устройство (секция «Заявки» карточки).
router.get("/client-devices/:id/tickets", isAuth, deviceController.getTickets);

router.post(
  "/client-devices/add",
  isAuth,
  canManageDevices,
  clientDeviceValidation,
  checkValidationResult,
  deviceController.add,
);
router.put(
  "/client-devices/update/:id",
  isAuth,
  canManageDevices,
  clientDeviceValidation,
  checkValidationResult,
  deviceController.update,
);
router.post(
  "/client-devices/:id/assign-user",
  isAuth,
  canManageDevices,
  deviceController.assignUser,
);
router.post(
  "/client-devices/:id/components",
  isAuth,
  canManageDevices,
  deviceController.attachComponent,
);
router.delete(
  "/client-devices/:id/components/:componentId",
  isAuth,
  canManageDevices,
  deviceController.detachComponent,
);
router.post(
  "/client-devices/:id/photos",
  isAuth,
  canManageDevices,
  uploadPhotos,
  deviceController.addPhotos,
);
router.delete(
  "/client-devices/:id/photos/:photoId",
  isAuth,
  canManageDevices,
  deviceController.deletePhoto,
);
router.delete(
  "/client-devices/delete/:id",
  isAuth,

  canManageDevices,
  deviceController.delete,
);

module.exports = router;
