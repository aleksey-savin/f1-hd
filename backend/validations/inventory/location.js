const { body } = require("express-validator");

const locationValidation = [
  body("name")
    .notEmpty()
    .withMessage("Название расположения обязательно")
    .isLength({ min: 2, max: 100 })
    .withMessage("Название должно содержать от 2 до 100 символов")
    .trim(),

  body("type")
    .notEmpty()
    .withMessage("Тип расположения обязателен")
    .isIn(["building", "floor", "room", "workplace", "storage"])
    .withMessage("Недопустимый тип расположения"),

  body("description")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Описание не должно превышать 500 символов")
    .trim(),

  body("parent")
    .optional()
    .isMongoId()
    .withMessage("Некорректный ID родительского расположения"),

  body("subdivision")
    .optional()
    .isMongoId()
    .withMessage("Некорректный ID подразделения"),

  body("assignedUser")
    .optional()
    .isMongoId()
    .withMessage("Некорректный ID назначенного пользователя"),

  body("defaultResponsible")
    .optional()
    .isMongoId()
    .withMessage("Некорректный ID ответственного по умолчанию"),

  body("address")
    .optional()
    .isLength({ max: 200 })
    .withMessage("Адрес не должен превышать 200 символов")
    .trim(),
  body("coordinates.floor")
    .optional()
    .isInt()
    .withMessage("Этаж должен быть целым числом"),
  body("tags").optional().isArray().withMessage("Теги должны быть массивом"),

  body("tags.*")
    .optional()
    .isString()
    .isLength({ max: 50 })
    .withMessage("Каждый тег должен быть строкой не более 50 символов"),

  body("notes")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("Заметки не должны превышать 1000 символов")
    .trim(),

  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("Поле isActive должно быть булевым значением"),

  body("isAccessible")
    .optional()
    .isBoolean()
    .withMessage("Поле isAccessible должно быть булевым значением"),

  body("isPublic")
    .optional()
    .isBoolean()
    .withMessage("Поле isPublic должно быть булевым значением"),

  // Validation for responsibility rules
  body("responsibilityRules.inheritFromParent")
    .optional()
    .isBoolean()
    .withMessage("inheritFromParent должно быть булевым значением"),

  body("responsibilityRules.deviceTypeOverrides")
    .optional()
    .isArray()
    .withMessage("deviceTypeOverrides должно быть массивом"),

  body("responsibilityRules.deviceTypeOverrides.*.deviceType")
    .optional()
    .isMongoId()
    .withMessage("Некорректный ID типа устройства в правилах ответственности"),

  body("responsibilityRules.deviceTypeOverrides.*.responsibleUser")
    .optional()
    .isMongoId()
    .withMessage("Некорректный ID ответственного пользователя в правилах"),

  body("responsibilityRules.deviceTypeOverrides.*.responsibilityType")
    .optional()
    .isIn(["user", "manager", "it_admin", "custom"])
    .withMessage("Недопустимый тип ответственности в правилах"),
];

// Custom validation for workplace type
const workplaceValidation = [
  body("assignedUser")
    .if(body("type").equals("workplace"))
    .notEmpty()
    .withMessage(
      "Для рабочего места необходимо указать назначенного пользователя",
    )
    .isMongoId()
    .withMessage("Некорректный ID назначенного пользователя"),

  body("assignedUser")
    .if(body("type").not().equals("workplace"))
    .isEmpty()
    .withMessage(
      "Назначенный пользователь может быть указан только для рабочих мест",
    ),
];

// Custom validation for coordinates
const coordinatesValidation = [
  body("coordinates")
    .optional()
    .custom((value) => {
      if (value && typeof value === "object") {
        const { x, y, floor } = value;

        // If coordinates object is provided, x and y should be numbers
        if (
          (x !== undefined && (typeof x !== "number" || isNaN(x))) ||
          (y !== undefined && (typeof y !== "number" || isNaN(y)))
        ) {
          throw new Error("Координаты X и Y должны быть числами");
        }

        // Floor should be integer if provided
        if (floor !== undefined && !Number.isInteger(floor)) {
          throw new Error("Этаж должен быть целым числом");
        }
      }
      return true;
    }),
];

// Custom validation for parent-child relationship
const hierarchyValidation = [
  body("parent")
    .optional()
    .custom(async (parentId, { req }) => {
      if (parentId) {
        const Location = require("../../models/inventory/location");

        // Check if parent exists
        const parent = await Location.findById(parentId);
        if (!parent) {
          throw new Error("Родительское расположение не найдено");
        }

        // Check if parent belongs to the same company
        if (parent.company.toString() !== req.user.company.toString()) {
          throw new Error(
            "Родительское расположение должно принадлежать той же компании",
          );
        }

        // For updates, check circular reference
        if (req.params.id && parentId === req.params.id) {
          throw new Error("Расположение не может быть родителем самого себя");
        }

        // Check if setting this parent would create a circular reference
        if (req.params.id) {
          let current = parent;
          while (current.parent) {
            if (current.parent.toString() === req.params.id) {
              throw new Error(
                "Данное назначение создаст циклическую зависимость",
              );
            }
            current = await Location.findById(current.parent);
            if (!current) break;
          }
        }
      }
      return true;
    }),
];

// Combined validation
const fullLocationValidation = [
  ...locationValidation,
  ...workplaceValidation,
  ...coordinatesValidation,
  ...hierarchyValidation,
];

module.exports = {
  locationValidation: fullLocationValidation,
  basicLocationValidation: locationValidation,
  workplaceValidation,
  coordinatesValidation,
  hierarchyValidation,
};
